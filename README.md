# ReachInbox Scheduler

A full-stack **email scheduling platform** that lets you schedule bulk email campaigns with configurable throttling, delivery tracking, and real-time search — built for the ReachInbox assignment.

🌐 **Live Demo:** https://reachinbox-scheduler-wheat.vercel.app

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite + TypeScript |
| Backend API | Express + TypeScript (Node ≥ 20) |
| Job Queue | BullMQ (backed by Redis) |
| Database | PostgreSQL via Prisma ORM |
| Search | Elasticsearch 8 |
| Auth | Google OAuth 2.0 |
| Email Sending | Brevo API (HTTPS) / Nodemailer SMTP |
| Infrastructure | Docker Compose (local) / Render + Neon + Upstash (production) |

---

## Features

- ✅ **Google OAuth Login** — Sign in with your Google account
- ✅ **Bulk Email Scheduling** — Upload a CSV of recipients, pick a time, send one by one
- ✅ **Rate Limiting** — Configurable hourly limits and minimum delays per sender
- ✅ **Multiple Senders** — Add as many SMTP/API senders as you want
- ✅ **Real-time Dashboard** — Track scheduled, processing, sent, and failed emails
- ✅ **Brevo API Support** — Works from any cloud host (bypasses SMTP port blocks)
- ✅ **BullMQ Worker** — Background email processing with retries
- ✅ **Bull Board** — Admin queue monitor at `/admin/queues`

---

## Project Structure

```
reachinbox-scheduler/
├── backend/                    # Express API + BullMQ worker
│   ├── prisma/                 # Prisma schema & migrations
│   ├── src/
│   │   ├── server.ts           # API entry point (port 4000)
│   │   ├── worker.ts           # Email queue worker (separate process)
│   │   ├── combined.ts         # API + Worker combined (for free hosting)
│   │   ├── config.ts           # Env validation
│   │   ├── routes/             # Auth, senders, emails
│   │   ├── services/           # Email queue, mailer, search, encryption
│   │   └── middleware/         # Auth guards
│   └── .env.example
├── frontend/                   # React + Vite SPA (port 5173)
│   ├── vercel.json             # Vercel SPA routing config
│   └── src/
│       ├── pages/              # Dashboard, compose, history
│       └── components/         # Reusable UI components
└── docker-compose.yml          # Postgres + Redis + Elasticsearch
```

---

## 🚀 Production Deployment (Free Hosting)

The live app is deployed on a fully free stack:

| Service | Platform | Purpose |
|---------|----------|---------|
| Frontend | **Vercel** | React SPA hosting |
| Backend API + Worker | **Render** (free web service) | Express API + BullMQ worker |
| PostgreSQL | **Neon.tech** | Serverless Postgres (free) |
| Redis | **Upstash** | Redis for sessions & queues (free) |
| Email Sending | **Brevo API** | Transactional emails via HTTPS |

### How to Deploy

1. **Neon** → Create free Postgres DB → copy `DATABASE_URL` (pooled) and `DIRECT_URL` (direct, no `-pooler`)
2. **Upstash** → Create free Redis DB → copy `REDIS_URL` (starts with `rediss://`)
3. **GitHub** → Push code: `git push origin main`
4. **Render** → New Web Service → connect GitHub repo:
   - Root Directory: `backend`
   - Build Command: `npm install && npm run build`
   - Start Command: `npm run start:combined`
   - Add all environment variables (see table below)
5. **Vercel** → New Project → import GitHub repo:
   - Root Directory: `frontend`
   - Add `VITE_API_BASE` = your Render backend URL
6. **Google Console** → Add Render URL to OAuth redirect URIs

---

## 📧 How to Send Real Emails

> ⚠️ Gmail SMTP is **blocked on cloud hosting** (Render, Railway, etc.) because cloud IPs are flagged by Gmail as spam sources. Use **Brevo API** instead — it sends via HTTPS and is never blocked.

### Method 1: Brevo API (Recommended for cloud hosting)

**Step 1 — Create free Brevo account**
1. Go to 👉 https://www.brevo.com → Sign up free
2. Verify your email address

**Step 2 — Get your API key**
1. Login to Brevo
2. Click profile icon (top right) → **"SMTP & API"**
3. Click the **"API Keys"** tab
4. Click **"Generate a new API key"** → name it `reachinbox`
5. Copy the key — it starts with **`xkeysib-`**

**Step 3 — Add sender in the app**
1. Go to the app → click **"Compose"**
2. Click **"+ Real SMTP"**
3. Fill in:

| Field | Value |
|-------|-------|
| From Email | `your-email@gmail.com` |
| SMTP Host | `api.brevo.com` ← **type exactly this** |
| SMTP Port | `443` |
| SMTP User | *(your Brevo login email)* |
| SMTP Password | `xkeysib-...` ← **your Brevo API key** |

4. Click **"Save SMTP sender"**

> 💡 The host `api.brevo.com` is a special keyword — the app detects it and uses Brevo's **HTTP API** instead of SMTP, so it works from any cloud host.

**Brevo Free Tier:** 300 emails/day, no credit card required.

---

### Method 2: Gmail App Password (Local development only)

This works on your local machine but **not on cloud hosting**.

**Step 1 — Enable 2-Factor Authentication on your Google account**
1. Go to https://myaccount.google.com/security
2. Enable **2-Step Verification**

**Step 2 — Create a Gmail App Password**
1. Go to https://myaccount.google.com/apppasswords
2. Select App: **Mail** → Device: **Other** → name it `reachinbox`
3. Click **Generate** → copy the 16-character password (e.g. `cwap dfuf gxfz sxsz`)

**Step 3 — Add sender in the app**
1. Go to app → **Compose** → **"+ Real SMTP"**
2. Fill in:

| Field | Value |
|-------|-------|
| From Email | `your-email@gmail.com` |
| SMTP Host | `smtp.gmail.com` |
| SMTP Port | `587` |
| SMTP User | `your-email@gmail.com` |
| SMTP Password | `cwap dfuf gxfz sxsz` ← App Password (spaces OK) |

---

## 🖥️ Local Development Setup

### Prerequisites

- **Node.js ≥ 20** — [Download](https://nodejs.org)
- **Docker Desktop** — [Download](https://www.docker.com/products/docker-desktop)
- **Google Cloud OAuth 2.0 credentials** — see [Google OAuth Setup](#google-oauth-setup)

### Step 1 — Clone & enter the project

```bash
git clone https://github.com/siddharthprajapati05/Reachinbox-scheduler.git
cd reachinbox-scheduler
```

### Step 2 — Install dependencies

```bash
# Backend
cd backend && npm install

# Frontend (new terminal)
cd frontend && npm install
```

### Step 3 — Configure environment variables

```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env`:

```env
# Google OAuth (required)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# Generate these (run in terminal):
# openssl rand -hex 32  → SESSION_SECRET
# openssl rand -hex 32  → ENCRYPTION_KEY
SESSION_SECRET=your-64-char-hex-secret
ENCRYPTION_KEY=your-64-char-hex-secret

# Filled automatically by Docker Compose:
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/reachinbox
REDIS_URL=redis://localhost:6379
ELASTICSEARCH_URL=http://localhost:9200

# Optional
ADMIN_EMAILS=your@email.com
```

### Step 4 — Start infrastructure (Docker)

```bash
docker compose up -d
```

Wait ~15 seconds, then verify:
```bash
docker compose ps   # all should show "healthy"
```

### Step 5 — Run database migrations

```bash
cd backend
npx prisma migrate dev --name init
```

### Step 6 — Start all services (4 terminals)

```bash
# Terminal 1 — Backend API
cd backend && npm run dev:api

# Terminal 2 — Email Worker
cd backend && npm run dev:worker

# Terminal 3 — Frontend
cd frontend && npm run dev
```

Open **http://localhost:5173** → Sign in with Google → start scheduling!

---

## Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services** → **Credentials**
2. Click **Create Credentials** → **OAuth client ID** → **Web application**
3. Add Authorized redirect URIs:
   - Local: `http://localhost:4000/api/auth/google/callback`
   - Production: `https://your-backend.onrender.com/api/auth/google/callback`
4. Copy the **Client ID** and **Client Secret** → paste in `.env`

---

## How to Send a Bulk Email Campaign

1. **Login** with Google at the app URL
2. Click **"Compose"** button
3. Select your sender (add one via **"+ Real SMTP"** if first time)
4. Fill in **Subject** and **Body**
5. Upload a **CSV file** with a column named `email`:
   ```csv
   email
   person1@gmail.com
   person2@yahoo.com
   person3@outlook.com
   ```
6. Set the **scheduled time** (when to start sending)
7. Optionally configure:
   - **Hourly limit** — max emails per hour (default: 200)
   - **Min delay** — seconds between each email (default: 2s)
8. Click **"Schedule emails"**
9. Watch the **Dashboard** — statuses update in real-time:
   - `scheduled` → waiting for send time
   - `processing` → being sent right now
   - `sent` → delivered ✅
   - `failed` → error (check the error column)

---

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | No | `development` | Runtime environment |
| `PORT` | No | `4000` | API server port |
| `FRONTEND_URL` | No | `http://localhost:5173` | CORS allowed origin |
| `BACKEND_URL` | No | `http://localhost:4000` | Used in logs and links |
| `DATABASE_URL` | **Yes** | — | PostgreSQL connection string (pooled for Neon) |
| `DIRECT_URL` | No | — | PostgreSQL direct URL (required for Neon migrations) |
| `REDIS_URL` | **Yes** | — | Redis connection string |
| `ELASTICSEARCH_URL` | No | `http://localhost:9200` | Elasticsearch URL (search disabled if unreachable) |
| `SESSION_SECRET` | **Yes** | — | ≥32 random chars for session signing |
| `ENCRYPTION_KEY` | **Yes** | — | Exactly 64 hex chars for SMTP password encryption |
| `GOOGLE_CLIENT_ID` | **Yes** | — | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | **Yes** | — | Google OAuth client secret |
| `ADMIN_EMAILS` | No | `""` | Comma-separated emails for Bull Board access |
| `WORKER_CONCURRENCY` | No | `5` | Parallel email sends per worker process |
| `MIN_DELAY_MS` | No | `2000` | Minimum gap between sends (ms) |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | No | `200` | Hourly send limit per sender account |
| `VITE_API_BASE` | No | `""` | Frontend: backend API base URL (set on Vercel) |

---

## Available Scripts

### Backend (`cd backend`)

| Command | Description |
|---------|-------------|
| `npm run dev:api` | Start API with hot-reload (development) |
| `npm run dev:worker` | Start email worker with hot-reload |
| `npm run build` | Compile TypeScript → `dist/` |
| `npm run start:api` | Run compiled API (production) |
| `npm run start:worker` | Run compiled worker (production) |
| `npm run start:combined` | Run API + Worker in single process (free hosting) |
| `npm run typecheck` | TypeScript type check |
| `npm run test` | Run Vitest test suite |
| `npm run prisma:migrate` | Create + apply new migration |
| `npm run prisma:deploy` | Apply pending migrations (CI/prod) |

### Frontend (`cd frontend`)

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server |
| `npm run build` | Production build |
| `npm run preview` | Preview production build locally |

---

## Troubleshooting

### Emails not sending on cloud hosting
Use **Brevo API** (host: `api.brevo.com`) — Gmail SMTP is blocked on cloud server IPs.

### `GOOGLE_CLIENT_ID is required` error
Fill in Google OAuth credentials in `backend/.env`.

### `connection refused` on port 5432 / 6379 / 9200
Run `docker compose up -d` and wait ~20 seconds for services to become healthy.

### Render deploy fails with Prisma migration timeout
Remove `&& npm run prisma:deploy` from the build command. Run migrations separately using the `DIRECT_URL` (non-pooled Neon connection).

### Dashboard shows 404 on Vercel
The `frontend/vercel.json` file must exist with SPA rewrite rules — it's already included in this repo.

---

## Architecture Diagram

```
Browser (Vercel)
      │
      │ HTTPS
      ▼
  Render (Free Web Service)
  ┌─────────────────────────────┐
  │  Express API  (port 4000)   │
  │  BullMQ Worker (inline)     │
  └──────┬──────────────────────┘
         │
    ┌────┴────────────────┐
    │                     │
    ▼                     ▼
Neon Postgres         Upstash Redis
(Database)            (Sessions + Queue)
                           │
                           ▼
                    Brevo HTTP API
                    (Email sending)
```
