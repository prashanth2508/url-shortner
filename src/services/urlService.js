import { encodeBase62, isValidSlug } from '../core/base62.js';
import { RangeIdGenerator } from '../core/idGenerator.js';
import { db } from '../database/db.js';
import { config } from '../config/index.js';

// Reserved paths that cannot be claimed as custom aliases
const RESERVED_WORDS = new Set([
  'api', 'health', 'metrics', 'analytics', 'favicon.ico', 'robots.txt',
  'static', 'assets', 'admin', 'dashboard', 'login', 'signup', 'auth'
]);

export class UrlService {
  constructor() {
    this.idGenerator = new RangeIdGenerator(
      config.distributed.nodeId,
      config.distributed.rangeStep
    );
  }

  /**
   * Validate long URL syntax
   */
  isValidUrl(urlString) {
    try {
      const parsed = new URL(urlString);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  /**
   * Shorten a URL (with custom alias or Base62 range allocator)
   */
  async shortenUrl({ longUrl, customAlias, ttlSeconds, domain, requestOrigin }) {
    if (!longUrl || typeof longUrl !== 'string') {
      throw { status: 400, message: 'longUrl is required and must be a valid string.' };
    }

    const trimmedUrl = longUrl.trim();
    if (!this.isValidUrl(trimmedUrl)) {
      throw { status: 400, message: 'Invalid URL. Must begin with http:// or https://' };
    }

    // Calculate expiry date if TTL specified
    let expiresAt = null;
    if (ttlSeconds && Number(ttlSeconds) > 0) {
      expiresAt = new Date(Date.now() + Number(ttlSeconds) * 1000);
    }

    let shortCode;
    let isCustom = false;

    if (customAlias) {
      const slug = customAlias.trim();
      if (!isValidSlug(slug)) {
        throw {
          status: 400,
          message: 'Invalid custom alias. Must be 3-30 characters (alphanumeric, hyphen, underscore).'
        };
      }
      if (RESERVED_WORDS.has(slug.toLowerCase())) {
        throw { status: 400, message: `The alias "${slug}" is a reserved system keyword.` };
      }

      // Check for collision
      const existing = await db.getUrlByCode(slug);
      if (existing) {
        throw { status: 409, message: `Custom alias "${slug}" is already in use. Please choose another.` };
      }

      shortCode = slug;
      isCustom = true;
    } else {
      // Distributed Range-Based Base62 Generation
      const uniqueId = await this.idGenerator.nextId(db);
      shortCode = encodeBase62(uniqueId, 6);
    }

    const record = await db.createUrl({
      shortCode,
      longUrl: trimmedUrl,
      isCustom,
      expiresAt
    });

    // Default to live host origin (e.g. https://url-shortner-yvf6.onrender.com)
    let liveOrigin = (requestOrigin && typeof requestOrigin === 'string' && !requestOrigin.includes('localhost:3000'))
      ? requestOrigin.replace(/\/$/, '')
      : config.baseUrl;

    // Filter out dummy/mock domains so the shortened link ALWAYS works and NEVER 404s
    const mockDomains = new Set(['https://aura.link', 'https://aura.sh', 'https://s.io', 'https://bit.ly', 'CURRENT_ORIGIN']);
    let activeDomain = liveOrigin;
    if (domain && typeof domain === 'string' && domain.trim() && !mockDomains.has(domain.trim())) {
      activeDomain = domain.trim().replace(/\/$/, '');
    }

    const shortUrl = `${activeDomain}/${record.shortCode}`;

    return {
      shortCode: record.shortCode,
      shortUrl,
      liveUrl: `${liveOrigin}/${record.shortCode}`,
      localUrl: `/${record.shortCode}`,
      domain: activeDomain,
      longUrl: record.longUrl,
      isCustom: record.isCustom,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt
    };
  }

  /**
   * Resolve short code for redirection
   */
  async resolveUrl(shortCode) {
    if (!shortCode) {
      throw { status: 400, message: 'Short code is required.' };
    }

    const record = await db.getUrlByCode(shortCode);
    if (!record) {
      throw { status: 404, message: 'Short URL not found.' };
    }

    // Expiry check
    if (record.expiresAt && new Date(record.expiresAt) < new Date()) {
      throw { status: 410, message: 'This short URL has expired.' };
    }

    return record;
  }
}

export const urlService = new UrlService();
