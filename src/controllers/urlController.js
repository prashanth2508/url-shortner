import { urlService } from '../services/urlService.js';
import { AnalyticsService } from '../services/analyticsService.js';
import { db } from '../database/db.js';
import { config } from '../config/index.js';

export class UrlController {
  /**
   * POST /api/v1/shorten
   */
  static async shorten(req, res) {
    try {
      const { longUrl, customAlias, ttlSeconds, domain } = req.body;
      const result = await urlService.shortenUrl({
        longUrl,
        customAlias,
        ttlSeconds,
        domain
      });
      return res.status(201).json({
        success: true,
        data: result
      });
    } catch (err) {
      const status = err.status || 500;
      return res.status(status).json({
        success: false,
        error: err.message || 'Internal server error'
      });
    }
  }

  /**
   * GET /:code - High-throughput redirection endpoint
   */
  static async redirect(req, res) {
    const { code } = req.params;

    // Guard against static file / system request leaks
    if (code === 'favicon.ico' || code.startsWith('api')) {
      return res.status(404).end();
    }

    try {
      const record = await urlService.resolveUrl(code);

      // Async fire-and-forget analytics: never block the redirect!
      AnalyticsService.recordClick(req, code).catch(err => {
        console.error('[AsyncAnalytics] Non-fatal logging failure:', err.message);
      });

      // 302 Found (Temporary Redirect) ensures client visits our server next time
      // so analytics are accurately recorded. (301 triggers permanent browser cache).
      return res.redirect(config.redirectStatus, record.longUrl);
    } catch (err) {
      const status = err.status || 500;
      if (status === 404) {
        return res.status(404).send(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>404 — Not Found</title>
              <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Plus Jakarta Sans', sans-serif; background: #09090b; color: #fafafa; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                .box { text-align: left; max-width: 440px; padding: 32px; background: #121214; border-radius: 12px; border: 1px solid #222226; }
                .code { font-size: 0.8rem; font-family: monospace; color: #a1a1aa; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 8px; }
                h1 { font-size: 1.5rem; margin: 0 0 12px; font-weight: 700; letter-spacing: -0.02em; }
                p { color: #71717a; font-size: 0.9rem; line-height: 1.6; margin: 0 0 24px; }
                a { display: inline-flex; align-items: center; background: #ffffff; color: #09090b; text-decoration: none; font-weight: 600; font-size: 0.85rem; padding: 8px 16px; border-radius: 6px; }
                a:hover { background: #e4e4e7; }
              </style>
            </head>
            <body>
              <div class="box">
                <div class="code">HTTP 404 • Not Found</div>
                <h1>Short link does not exist</h1>
                <p>The code <code>/${code}</code> was not found on this cluster or may have expired.</p>
                <a href="/">← Return to Shortener</a>
              </div>
            </body>
          </html>
        `);
      }

      if (status === 410) {
        return res.status(410).send(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>410 — Link Expired</title>
              <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Plus Jakarta Sans', sans-serif; background: #09090b; color: #fafafa; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                .box { text-align: left; max-width: 440px; padding: 32px; background: #121214; border-radius: 12px; border: 1px solid #222226; }
                .code { font-size: 0.8rem; font-family: monospace; color: #f59e0b; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 8px; }
                h1 { font-size: 1.5rem; margin: 0 0 12px; font-weight: 700; letter-spacing: -0.02em; }
                p { color: #71717a; font-size: 0.9rem; line-height: 1.6; margin: 0 0 24px; }
                a { display: inline-flex; align-items: center; background: #ffffff; color: #09090b; text-decoration: none; font-weight: 600; font-size: 0.85rem; padding: 8px 16px; border-radius: 6px; }
                a:hover { background: #e4e4e7; }
              </style>
            </head>
            <body>
              <div class="box">
                <div class="code">HTTP 410 • TTL Expired</div>
                <h1>This short link has expired</h1>
                <p>The short link <code>/${code}</code> has exceeded its defined Time-To-Live expiration window.</p>
                <a href="/">← Create New Link</a>
              </div>
            </body>
          </html>
        `);
      }

      return res.status(status).json({ success: false, error: err.message });
    }
  }

  /**
   * GET /api/v1/analytics/:code
   */
  static async getAnalytics(req, res) {
    try {
      const { code } = req.params;
      const data = await AnalyticsService.getSummary(code);
      if (!data) {
        return res.status(404).json({ success: false, error: 'Short link not found' });
      }
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * GET /api/v1/urls/recent
   */
  static async getRecentUrls(req, res) {
    try {
      const limit = Math.min(parseInt(req.query.limit || '10', 10), 50);
      const urls = await db.getRecentUrls(limit);
      return res.json({ success: true, data: urls });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * GET /health
   */
  static async healthCheck(req, res) {
    const mem = process.memoryUsage();
    return res.json({
      status: 'healthy',
      nodeId: config.distributed.nodeId,
      dbEngine: db.type,
      uptimeSeconds: Math.floor(process.uptime()),
      memory: {
        rssMb: (mem.rss / 1024 / 1024).toFixed(2),
        heapUsedMb: (mem.heapUsed / 1024 / 1024).toFixed(2)
      },
      timestamp: new Date().toISOString()
    });
  }
}
