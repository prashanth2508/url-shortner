import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config/index.js';
import { db } from './database/db.js';
import { rateLimiter } from './middleware/rateLimiter.js';
import { UrlController } from './controllers/urlController.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, '../public');

async function bootstrap() {
  const app = express();

  // Trust proxy for real IP resolution behind Nginx/Load balancer
  app.set('trust proxy', 1);

  // Core Middleware
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Global Rate Limiting
  app.use(rateLimiter.middleware());

  // Static Assets for Minimalist UI
  app.use(express.static(publicDir));

  // Initialize Storage Engine (SQLite or PostgreSQL)
  await db.init();

  // API Routes
  app.post('/api/v1/shorten', UrlController.shorten);
  app.get('/api/v1/analytics/:code', UrlController.getAnalytics);
  app.get('/api/v1/urls/recent', UrlController.getRecentUrls);
  app.get('/health', UrlController.healthCheck);

  // Redirection Route (Must be declared after API routes)
  app.get('/:code', UrlController.redirect);

  // Start Server
  const server = app.listen(config.port, () => {
    console.log(`====================================================`);
    console.log(`⚡ Distributed URL Shortener [Node ID: ${config.distributed.nodeId}]`);
    console.log(`🌐 Server running at: http://localhost:${config.port}`);
    console.log(`🗄️  Storage Engine: ${db.type.toUpperCase()}`);
    console.log(`⏱️  Default Redirect: HTTP ${config.redirectStatus}`);
    console.log(`🛡️  Rate Limiter: Active (${config.rateLimit.max} req / ${config.rateLimit.windowMs / 1000}s)`);
    console.log(`====================================================`);
  });

  // Graceful Shutdown
  const shutdown = () => {
    console.log('\n[Server] Gracefully shutting down...');
    server.close(() => {
      console.log('[Server] HTTP connections closed.');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch(err => {
  console.error('[Bootstrap] Fatal startup error:', err);
  process.exit(1);
});
