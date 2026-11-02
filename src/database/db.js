import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';
import { config } from '../config/index.js';

const { Pool } = pg;

class DatabaseService {
  constructor() {
    this.type = config.dbType;
    this.sqlite = null;
    this.pgPool = null;
  }

  async init() {
    if (this.type === 'postgres') {
      try {
        this.pgPool = new Pool({
          connectionString: config.databaseUrl,
          max: 20,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 5000,
        });
        await this.initPostgresSchema();
        console.log('[Database] Connected to PostgreSQL successfully.');
        return;
      } catch (err) {
        console.warn('[Database] PostgreSQL connection failed. Falling back to native SQLite.', err.message);
        this.type = 'sqlite';
      }
    }

    // Default: Native SQLite for seamless zero-dependency execution
    const dataDir = path.resolve(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const dbPath = path.join(dataDir, 'shortener.sqlite');
    this.sqlite = new DatabaseSync(dbPath);
    this.initSqliteSchema();
    console.log(`[Database] Native SQLite initialized at ${dbPath}`);
  }

  initSqliteSchema() {
    this.sqlite.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;

      -- Core URLs table
      CREATE TABLE IF NOT EXISTS urls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        short_code VARCHAR(32) UNIQUE NOT NULL,
        long_url TEXT NOT NULL,
        is_custom BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NULL,
        click_count INTEGER DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_urls_short_code ON urls(short_code);
      CREATE INDEX IF NOT EXISTS idx_urls_created_at ON urls(created_at DESC);

      -- Click Analytics table
      CREATE TABLE IF NOT EXISTS clicks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        short_code VARCHAR(32) NOT NULL,
        clicked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        ip_hash VARCHAR(64),
        user_agent TEXT,
        referrer TEXT,
        country VARCHAR(64) DEFAULT 'Unknown',
        device_type VARCHAR(32) DEFAULT 'Desktop'
      );

      CREATE INDEX IF NOT EXISTS idx_clicks_code ON clicks(short_code);
      CREATE INDEX IF NOT EXISTS idx_clicks_time ON clicks(clicked_at DESC);

      -- Distributed ID Range allocator table (Ticket Server pattern)
      CREATE TABLE IF NOT EXISTS id_ranges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        node_id INTEGER NOT NULL,
        last_allocated_id INTEGER DEFAULT 1000000,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Seed default range allocator if not present
    const checkStmt = this.sqlite.prepare('SELECT COUNT(*) as count FROM id_ranges WHERE node_id = ?');
    const res = checkStmt.get(config.distributed.nodeId);
    if (!res || res.count === 0) {
      const insertStmt = this.sqlite.prepare('INSERT INTO id_ranges (node_id, last_allocated_id) VALUES (?, ?)');
      insertStmt.run(config.distributed.nodeId, 1000000);
    }
  }

  async initPostgresSchema() {
    const client = await this.pgPool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS urls (
          id BIGSERIAL PRIMARY KEY,
          short_code VARCHAR(32) UNIQUE NOT NULL,
          long_url TEXT NOT NULL,
          is_custom BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          expires_at TIMESTAMPTZ NULL,
          click_count BIGINT DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_urls_short_code ON urls(short_code);
        CREATE INDEX IF NOT EXISTS idx_urls_created_at ON urls(created_at DESC);

        CREATE TABLE IF NOT EXISTS clicks (
          id BIGSERIAL PRIMARY KEY,
          short_code VARCHAR(32) NOT NULL,
          clicked_at TIMESTAMPTZ DEFAULT NOW(),
          ip_hash VARCHAR(64),
          user_agent TEXT,
          referrer TEXT,
          country VARCHAR(64) DEFAULT 'Unknown',
          device_type VARCHAR(32) DEFAULT 'Desktop'
        );

        CREATE INDEX IF NOT EXISTS idx_clicks_code ON clicks(short_code);
        CREATE INDEX IF NOT EXISTS idx_clicks_time ON clicks(clicked_at DESC);

        CREATE TABLE IF NOT EXISTS id_ranges (
          id SERIAL PRIMARY KEY,
          node_id INT NOT NULL UNIQUE,
          last_allocated_id BIGINT DEFAULT 1000000,
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );

        INSERT INTO id_ranges (node_id, last_allocated_id)
        VALUES (${config.distributed.nodeId}, 1000000)
        ON CONFLICT (node_id) DO NOTHING;
      `);
    } finally {
      client.release();
    }
  }

  async getNextIdRange(nodeId, step = 100000) {
    if (this.type === 'sqlite') {
      const getStmt = this.sqlite.prepare('SELECT last_allocated_id FROM id_ranges WHERE node_id = ?');
      const row = getStmt.get(nodeId);
      const current = BigInt(row ? row.last_allocated_id : 1000000);
      const next = current + BigInt(step);

      const updateStmt = this.sqlite.prepare('UPDATE id_ranges SET last_allocated_id = ?, updated_at = CURRENT_TIMESTAMP WHERE node_id = ?');
      updateStmt.run(Number(next), nodeId);

      return { startId: current, endId: next };
    } else {
      const client = await this.pgPool.connect();
      try {
        const res = await client.query(
          `UPDATE id_ranges 
           SET last_allocated_id = last_allocated_id + $1, updated_at = NOW() 
           WHERE node_id = $2 
           RETURNING last_allocated_id - $1 AS start_id, last_allocated_id AS end_id`,
          [step, nodeId]
        );
        return {
          startId: BigInt(res.rows[0].start_id),
          endId: BigInt(res.rows[0].end_id)
        };
      } finally {
        client.release();
      }
    }
  }

  async createUrl({ shortCode, longUrl, isCustom = false, expiresAt = null }) {
    if (this.type === 'sqlite') {
      const stmt = this.sqlite.prepare(`
        INSERT INTO urls (short_code, long_url, is_custom, expires_at)
        VALUES (?, ?, ?, ?)
      `);
      stmt.run(shortCode, longUrl, isCustom ? 1 : 0, expiresAt ? new Date(expiresAt).toISOString() : null);
      return this.getUrlByCode(shortCode);
    } else {
      const res = await this.pgPool.query(
        `INSERT INTO urls (short_code, long_url, is_custom, expires_at)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [shortCode, longUrl, isCustom, expiresAt ? new Date(expiresAt) : null]
      );
      return res.rows[0];
    }
  }

  async getUrlByCode(shortCode) {
    if (this.type === 'sqlite') {
      const stmt = this.sqlite.prepare('SELECT * FROM urls WHERE short_code = ?');
      const row = stmt.get(shortCode);
      if (!row) return null;
      return {
        id: row.id,
        shortCode: row.short_code,
        longUrl: row.long_url,
        isCustom: Boolean(row.is_custom),
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        clickCount: Number(row.click_count)
      };
    } else {
      const res = await this.pgPool.query('SELECT * FROM urls WHERE short_code = $1', [shortCode]);
      if (res.rows.length === 0) return null;
      const row = res.rows[0];
      return {
        id: row.id,
        shortCode: row.short_code,
        longUrl: row.long_url,
        isCustom: Boolean(row.is_custom),
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        clickCount: Number(row.click_count)
      };
    }
  }

  async incrementClickCount(shortCode) {
    if (this.type === 'sqlite') {
      const stmt = this.sqlite.prepare('UPDATE urls SET click_count = click_count + 1 WHERE short_code = ?');
      stmt.run(shortCode);
    } else {
      await this.pgPool.query('UPDATE urls SET click_count = click_count + 1 WHERE short_code = $1', [shortCode]);
    }
  }

  async recordClick({ shortCode, ipHash, userAgent, referrer, country, deviceType }) {
    if (this.type === 'sqlite') {
      const stmt = this.sqlite.prepare(`
        INSERT INTO clicks (short_code, ip_hash, user_agent, referrer, country, device_type)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      stmt.run(shortCode, ipHash, userAgent, referrer, country, deviceType);
    } else {
      await this.pgPool.query(
        `INSERT INTO clicks (short_code, ip_hash, user_agent, referrer, country, device_type)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [shortCode, ipHash, userAgent, referrer, country, deviceType]
      );
    }
  }

  async getAnalytics(shortCode) {
    const url = await this.getUrlByCode(shortCode);
    if (!url) return null;

    let recentClicks = [];
    let topReferrers = [];
    let deviceBreakdown = [];

    if (this.type === 'sqlite') {
      const clicksStmt = this.sqlite.prepare(`
        SELECT clicked_at, country, device_type, referrer 
        FROM clicks 
        WHERE short_code = ? 
        ORDER BY clicked_at DESC 
        LIMIT 20
      `);
      recentClicks = clicksStmt.all(shortCode);

      const refStmt = this.sqlite.prepare(`
        SELECT COALESCE(NULLIF(referrer, ''), 'Direct / Unknown') as referrer, COUNT(*) as count 
        FROM clicks 
        WHERE short_code = ? 
        GROUP BY referrer 
        ORDER BY count DESC 
        LIMIT 5
      `);
      topReferrers = refStmt.all(shortCode);

      const devStmt = this.sqlite.prepare(`
        SELECT device_type as device, COUNT(*) as count 
        FROM clicks 
        WHERE short_code = ? 
        GROUP BY device_type
      `);
      deviceBreakdown = devStmt.all(shortCode);
    } else {
      const clicksRes = await this.pgPool.query(
        `SELECT clicked_at, country, device_type, referrer 
         FROM clicks 
         WHERE short_code = $1 
         ORDER BY clicked_at DESC 
         LIMIT 20`,
        [shortCode]
      );
      recentClicks = clicksRes.rows;

      const refRes = await this.pgPool.query(
        `SELECT COALESCE(NULLIF(referrer, ''), 'Direct / Unknown') as referrer, COUNT(*) as count 
         FROM clicks 
         WHERE short_code = $1 
         GROUP BY referrer 
         ORDER BY count DESC 
         LIMIT 5`,
        [shortCode]
      );
      topReferrers = refRes.rows;

      const devRes = await this.pgPool.query(
        `SELECT device_type as device, COUNT(*) as count 
         FROM clicks 
         WHERE short_code = $1 
         GROUP BY device_type`,
        [shortCode]
      );
      deviceBreakdown = devRes.rows;
    }

    return {
      url,
      totalClicks: url.clickCount,
      recentClicks,
      topReferrers,
      deviceBreakdown
    };
  }

  async getRecentUrls(limit = 10) {
    if (this.type === 'sqlite') {
      const stmt = this.sqlite.prepare(`
        SELECT short_code as shortCode, long_url as longUrl, is_custom as isCustom, 
               created_at as createdAt, expires_at as expiresAt, click_count as clickCount 
        FROM urls 
        ORDER BY created_at DESC 
        LIMIT ?
      `);
      return stmt.all(limit);
    } else {
      const res = await this.pgPool.query(
        `SELECT short_code as "shortCode", long_url as "longUrl", is_custom as "isCustom", 
                created_at as "createdAt", expires_at as "expiresAt", click_count as "clickCount" 
         FROM urls 
         ORDER BY created_at DESC 
         LIMIT $1`,
        [limit]
      );
      return res.rows;
    }
  }
}

export const db = new DatabaseService();
