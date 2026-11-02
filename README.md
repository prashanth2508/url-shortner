# AuraURL — High-Throughput Distributed URL Shortener

[![Node.js](https://img.shields.io/badge/Node.js-v22-green.svg)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4.21-blue.svg)](https://expressjs.com/)
[![Database](https://img.shields.io/badge/Storage-SQLite%20%2F%20PostgreSQL-336791.svg)](https://www.postgresql.org/)
[![Architecture](https://img.shields.io/badge/Architecture-Distributed%20Base62-orange.svg)]()
[![Design](https://img.shields.io/badge/UI%2FUX-Minimalist%20Monochrome-black.svg)]()
[![License](https://img.shields.io/badge/License-MIT-purple.svg)](LICENSE)

A scalable, low-latency, distributed URL shortening engine (similar to Bitly) engineered for read-heavy workloads (100:1 read/write ratio). Features 64-bit Base62 bijective encoding, ticket-server range allocation, asynchronous telemetry logging, and a modern minimalist web interface.

---

## 🏛️ High-Level System Architecture

```
[ Client Browser / API Consumer ]
               │
               ▼
   [ Nginx Load Balancer / Ingress ]
               │
  ┌────────────┴────────────┐
  ▼                         ▼
[ Node 1 (IDs: 1M-1.1M) ]  [ Node 2 (IDs: 1.1M-1.2M) ]
  │                         │
  ├───────► [ Redis Cache Tier (<5ms) ]
  │
  ├───────► [ PostgreSQL Primary (Writes / Slugs) ]
  │              │ (Replication)
  │              ▼
  │         [ PostgreSQL Read Replicas (Reads) ]
  │
  └───────► [ Asynchronous Telemetry Pipeline ]
```

---

## 📊 Back-of-the-Envelope Capacity Estimation

| Metric | Target Calculation | Production Scale |
| :--- | :--- | :--- |
| **New URLs Generated** | 100 Million / month | ~38.6 writes/sec (Peak: ~100/sec) |
| **Read/Redirect Volume** | 100:1 Read-to-Write ratio | ~3,860 reads/sec (Peak: ~10,000/sec) |
| **5-Year URL Storage** | 6 Billion records @ ~632 bytes | ~3.79 TB Storage volume |
| **Active Cache Memory** | 80/20 Pareto rule (20% hot links) | ~33.9 GB RAM in Redis |
| **Slug Combinations** | 64-bit Base62 encoding (`62⁷`) | **3.52 Trillion** unique 7-char URLs |

---

## ✨ Key Features

- **Distributed Range-Based ID Generator**: Uses the Ticket Server range-allocation pattern to assign blocks of 100,000 IDs per node. Completely eliminates cross-database lock contention during writes.
- **Bijective Base62 Encoding**: Bi-directional conversion between 64-bit integers and alphanumeric slugs `[0-9a-zA-Z]`. Zero URL-encoding characters.
- **HTTP 302 Redirection**: Uses temporary redirects so clients query the cluster on every click, guaranteeing 100% accurate click analytics and audit trails.
- **Asynchronous Click Telemetry**: Redirect requests fire click logging events in the background (fire-and-forget), achieving `<50ms` redirect response times.
- **Custom Slugs & Expiry (TTL)**: Collision detection for custom aliases and automated TTL checks returning `HTTP 410 Gone` upon expiry.
- **IP Sliding-Window Rate Limiting**: Built-in sliding-window limiter protecting the cluster against DDoS and brute-force abuse.
- **Minimalist Web UI**: High-contrast, Swiss/Linear-inspired responsive interface with instant QR code generation and built-in click inspector.

---

## 🚀 Quick Start

### 1. Prerequisites
- Node.js v20+ or v22+
- npm v10+

### 2. Local Installation & Run
```bash
# Clone the repository
git clone https://github.com/prashanth2508/url-shortner.git
cd url-shortner

# Install dependencies
npm install

# Start the server (Zero-config SQLite engine)
npm start
```
Server runs at: `http://localhost:3000`

### 3. Running with Docker Compose (PostgreSQL + Redis + App)
```bash
docker compose up --build -d
```

---

## 📡 REST API Documentation

### 1. Shorten URL
`POST /api/v1/shorten`
```json
{
  "longUrl": "https://en.wikipedia.org/wiki/Distributed_computing",
  "customAlias": "dist-sys",
  "ttlSeconds": 86400
}
```
**Response (`201 Created`):**
```json
{
  "success": true,
  "data": {
    "shortCode": "dist-sys",
    "shortUrl": "https://aura.link/dist-sys",
    "longUrl": "https://en.wikipedia.org/wiki/Distributed_computing",
    "isCustom": true,
    "createdAt": "2026-11-02T16:00:00.000Z",
    "expiresAt": "2026-11-03T16:00:00.000Z"
  }
}
```

### 2. Redirect to Destination
`GET /:code`
- **Response**: `HTTP 302 Found`
- **Header**: `Location: <destination_url>`

### 3. Click Analytics & Telemetry
`GET /api/v1/analytics/:code`
**Response (`200 OK`):**
```json
{
  "success": true,
  "data": {
    "totalClicks": 42,
    "recentClicks": [
      { "clicked_at": "...", "device_type": "Mobile", "country": "Global", "referrer": "Direct" }
    ],
    "topReferrers": [{ "referrer": "Direct", "count": 35 }],
    "deviceBreakdown": [{ "device": "Desktop", "count": 28 }, { "device": "Mobile", "count": 14 }]
  }
}
```

### 4. Health Check
`GET /health`

---

## 🎓 Viva & System Design Interview Concepts Covered

1. **Why Base62 instead of Base64 or MD5?**
   - Base64 uses `+` and `/` which require percent-encoding in URLs (`%2B`, `%2F`).
   - MD5 produces a 128-bit hash (32 hex characters); truncating hashes introduces high collision rates requiring database read-loops. Base62 on 64-bit integers guarantees zero collisions.
2. **HTTP 301 vs HTTP 302?**
   - `301 Moved Permanently`: Cached indefinitely in browser memory; future clicks bypass the backend entirely, making click analytics impossible.
   - `302 Found`: Browser queries the backend on every navigation, ensuring real-time click telemetry and rate limiting.
3. **CAP Theorem Trade-Off**:
   - The redirection path is **AP (Available + Partition Tolerant)**: High availability and low latency take precedence over strict replication consistency.
   - The slug reservation path is **CP (Consistent + Partition Tolerant)**: To prevent duplicate custom aliases.

---

## 📄 License
MIT License. Created for distributed systems academic research and engineering portfolios.
