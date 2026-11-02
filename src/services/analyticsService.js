import crypto from 'node:crypto';
import { db } from '../database/db.js';

export class AnalyticsService {
  /**
   * Hashes client IP using SHA-256 for privacy and deduplication
   */
  static hashIp(ip) {
    if (!ip) return 'anonymous';
    return crypto.createHash('sha256').update(ip + '_shortener_salt').digest('hex').substring(0, 16);
  }

  /**
   * Parses simple device category from User-Agent string
   */
  static parseDevice(userAgent = '') {
    const ua = userAgent.toLowerCase();
    if (/mobile|android|iphone|ipod|blackberry|windows phone/i.test(ua)) {
      return 'Mobile';
    }
    if (/tablet|ipad/i.test(ua)) {
      return 'Tablet';
    }
    return 'Desktop';
  }

  /**
   * Asynchronously logs click metrics without blocking the HTTP redirect
   */
  static async recordClick(req, shortCode) {
    try {
      const rawIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || '';
      const ipHash = this.hashIp(rawIp);
      const userAgent = req.headers['user-agent'] || 'Unknown';
      const rawReferrer = req.headers['referer'] || req.headers['referrer'] || '';
      const deviceType = this.parseDevice(userAgent);

      // Clean referrer domain if present
      let referrer = 'Direct / Bookmarks';
      if (rawReferrer) {
        try {
          const parsed = new URL(rawReferrer);
          referrer = parsed.hostname;
        } catch {
          referrer = rawReferrer.substring(0, 50);
        }
      }

      // Geo approximation header (Cloudflare / Nginx CF-IPCountry or standard)
      const country = req.headers['cf-ipcountry'] || req.headers['x-country'] || 'Global';

      // Increment counter & log event
      await Promise.all([
        db.incrementClickCount(shortCode),
        db.recordClick({
          shortCode,
          ipHash,
          userAgent: userAgent.substring(0, 255),
          referrer,
          country,
          deviceType
        })
      ]);
    } catch (err) {
      console.error('[Analytics] Failed to record click event:', err.message);
    }
  }

  static async getSummary(shortCode) {
    return db.getAnalytics(shortCode);
  }
}
