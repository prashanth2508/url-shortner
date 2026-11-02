import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  baseUrl: (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, ''),
  shortDomain: (process.env.SHORT_DOMAIN || process.env.BASE_URL || '').replace(/\/$/, ''),
  dbType: process.env.DB_TYPE || 'sqlite',
  databaseUrl: process.env.DATABASE_URL || 'postgres://localhost:5432/url_shortener',
  redirectStatus: parseInt(process.env.REDIRECT_STATUS || '302', 10),
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10)
  },
  distributed: {
    nodeId: parseInt(process.env.NODE_ID || '1', 10),
    rangeStep: parseInt(process.env.RANGE_STEP || '100000', 10)
  }
};
