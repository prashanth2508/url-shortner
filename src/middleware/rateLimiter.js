import { config } from '../config/index.js';

/**
 * In-Memory Sliding-Window Counter Rate Limiter
 * Tracks request counts per client IP over a sliding time window.
 * (Migrates to Redis sliding-log / Token Bucket in Phase 2 for distributed instances)
 */
class InMemoryRateLimiter {
  constructor(windowMs = 60000, maxRequests = 100) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.ipHits = new Map();

    // Housekeeping: clean expired buckets every 60 seconds
    setInterval(() => this.cleanup(), 60000);
  }

  middleware() {
    return (req, res, next) => {
      const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1';
      const now = Date.now();
      const windowStart = now - this.windowMs;

      let timestamps = this.ipHits.get(ip) || [];
      // Filter out timestamps outside the current sliding window
      timestamps = timestamps.filter(ts => ts > windowStart);

      if (timestamps.length >= this.maxRequests) {
        const oldest = timestamps[0];
        const retryAfterSec = Math.ceil((oldest + this.windowMs - now) / 1000);

        res.set({
          'X-RateLimit-Limit': this.maxRequests,
          'X-RateLimit-Remaining': 0,
          'X-RateLimit-Reset': Math.ceil((oldest + this.windowMs) / 1000),
          'Retry-After': retryAfterSec
        });

        return res.status(429).json({
          error: 'Too Many Requests',
          message: `Rate limit exceeded. Maximum ${this.maxRequests} requests per minute allowed.`,
          retryAfterSeconds: retryAfterSec
        });
      }

      timestamps.push(now);
      this.ipHits.set(ip, timestamps);

      res.set({
        'X-RateLimit-Limit': this.maxRequests,
        'X-RateLimit-Remaining': this.maxRequests - timestamps.length,
        'X-RateLimit-Reset': Math.ceil((now + this.windowMs) / 1000)
      });

      next();
    };
  }

  cleanup() {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    for (const [ip, timestamps] of this.ipHits.entries()) {
      const valid = timestamps.filter(ts => ts > windowStart);
      if (valid.length === 0) {
        this.ipHits.delete(ip);
      } else {
        this.ipHits.set(ip, valid);
      }
    }
  }
}

export const rateLimiter = new InMemoryRateLimiter(
  config.rateLimit.windowMs,
  config.rateLimit.max
);
