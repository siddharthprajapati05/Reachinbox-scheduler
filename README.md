# ReachInbox Scheduler

A full-stack **email scheduling platform** that lets you schedule bulk email campaigns with configurable throttling, delivery tracking, and real-time Elasticsearch-powered search.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite + TypeScript + Tailwind CSS |
| Backend API | Express + TypeScript (Node ≥ 20) |
| Job Queue | BullMQ (backed by Redis) |
| Database | PostgreSQL via Prisma ORM |
| Search | Elasticsearch 8 |
| Auth | Google OAuth 2.0 |
| Infrastructure | Docker Compose (Postgres + Redis + Elasticsearch) |

---

## Prerequisites

- **Node.js ≥ 20** — [Download](https://nodejs.org)
- **Docker Desktop** — [Download](https://www.docker.com/products/docker-desktop)
- **A Google Cloud OAuth 2.0 client** — see [Google OAuth Setup](#google-oauth-setup)

---

## Project Structure

```
reachinbox-scheduler/
├── backend/              # Express API + BullMQ worker
│   ├── prisma/           # Prisma schema & migrations
│   ├── src/
│   │   ├── server.ts     # API entry point (port 4000)
│   │   ├── worker.ts     # Email queue worker
│   │   ├── config.ts     # Env validation
│   │   ├── routes/       # Auth, senders, emails, slack
│   │   ├── services/     # Email queue, search, encryption
│   │   └── middleware/   # Auth guards
│   └── .env.example
├── frontend/             # React + Vite SPA (port 5173)
│   └── src/
│       ├── pages/        # Dashboard, compose, history
│       └── components/   # Reusable UI components
└── docker-compose.yml    # Postgres + Redis + Elasticsearch
```

---

## Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services** → **Credentials**
2. Click **Create Credentials** → **OAuth client ID**
3. Application type: **Web application**
4. Add Authorized redirect URI: `http://localhost:4000/api/auth/google/callback`
5. Copy the **Client ID** and **Client Secret**

---

## Full Setup & Run Guide

### Step 1 — Clone & enter the project

```bash
git clone <repo-url>
cd reachinbox-scheduler
```

### Step 2 — Install dependencies

```bash
# Backend
cd backend
npm install

# Frontend (open a new terminal tab)
cd frontend
npm install
```

### Step 3 — Configure environment variables

```bash
# Copy the example env file
cp backend/.env.example backend/.env
```

Open `backend/.env` and fill in the required values:

```env
# ---------- Required: Google OAuth ----------
GOOGLE_CLIENT_ID=<your-google-client-id>
GOOGLE_CLIENT_SECRET=<your-google-client-secret>

# ---------- Required: Generate these secrets ----------
# Run each command and paste the output:
SESSION_SECRET=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)

# ---------- Optional: Slack notifications ----------
SLACK_CLIENT_ID=
SLACK_CLIENT_SECRET=
SLACK_REDIRECT_URL=http://localhost:4000/api/slack/callback

# ---------- Optional: Who can access Bull Board ----------
ADMIN_EMAILS=your@email.com
```

### Step 4 — Start infrastructure (Docker)

```bash
# From the project root
docker compose up -d
```

This starts three containers:
- `postgres:16-alpine` on port **5432**
- `redis:7-alpine` on port **6379**
- `elasticsearch:8.15.0` on port **9200**

Wait ~15 seconds and verify all are healthy:
```bash
docker compose ps
```

### Step 5 — Run database migrations

```bash
cd backend

# First time: creates and applies migration
npx prisma migrate dev --name init --skip-seed

# Subsequent runs / CI: apply existing migrations only
npx prisma migrate deploy
```

### Step 6 — Start the backend API

```bash
cd backend
npm run dev:api
```

> API listens on **http://localhost:4000**

### Step 7 — Start the email worker (new terminal)

```bash
cd backend
npm run dev:worker
```

> The worker processes the BullMQ email queue. Must run alongside the API for emails to actually send.

### Step 8 — Start the frontend

```bash
cd frontend
npm run dev
```

> Frontend runs at **http://localhost:5173**

---

## All Running Services

| Service | URL | Description |
|---------|-----|-------------|
| Frontend | http://localhost:5173 | React SPA |
| Backend API | http://localhost:4000 | REST API |
| Health Check | http://localhost:4000/api/health | Returns `{"data":{"status":"ok"}}` |
| Bull Board | http://localhost:4000/admin/queues | Queue monitor (admin login required) |
| PostgreSQL | localhost:5432 | Database |
| Redis | localhost:6379 | Session store + job queue |
| Elasticsearch | http://localhost:9200 | Full-text search |

---

## Available Scripts

### Backend (`cd backend`)

| Command | Description |
|---------|-------------|
| `npm run dev:api` | Start API with hot-reload |
| `npm run dev:worker` | Start email worker with hot-reload |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run start:api` | Run compiled API (production) |
| `npm run start:worker` | Run compiled worker (production) |
| `npm run typecheck` | TypeScript type check (no emit) |
| `npm run test` | Run Vitest test suite |
| `npm run prisma:generate` | Regenerate Prisma client |
| `npm run prisma:migrate` | Create + apply new migration |
| `npm run prisma:deploy` | Apply pending migrations (CI/prod) |
| `npm run reindex` | Re-index all emails into Elasticsearch |

### Frontend (`cd frontend`)

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server with HMR |
| `npm run build` | TypeScript check + production build |
| `npm run preview` | Preview the production build locally |
| `npm run typecheck` | TypeScript type check (no emit) |

### Docker

```bash
# Start all infra services
docker compose up -d

# Stop all services (keeps data volumes)
docker compose stop

# Stop and remove containers + volumes (wipes database)
docker compose down -v

# View logs for all services
docker compose logs -f

# View logs for a specific service
docker compose logs -f postgres
docker compose logs -f redis
docker compose logs -f elasticsearch
```

---

## Quick Start (All-in-One)

After completing Steps 1–3 above, run the following in 4 terminal tabs:

```bash
# Terminal 1 — Infrastructure
docker compose up -d

# Terminal 2 — Backend API
cd backend && npm run dev:api

# Terminal 3 — Email Worker
cd backend && npm run dev:worker

# Terminal 4 — Frontend
cd frontend && npm run dev
```

Then open **http://localhost:5173** and sign in with Google.

---

## Stopping the Project

```bash
# Stop Node processes: Ctrl+C in each terminal

# Stop Docker services (data is preserved)
docker compose stop

# Remove everything including data volumes
docker compose down -v
```

---

## Troubleshooting

### `GOOGLE_CLIENT_ID is required` error
You must fill in Google OAuth credentials in `backend/.env`. The app cannot start without them. See [Google OAuth Setup](#google-oauth-setup).

### `connection refused` on port 5432 / 6379 / 9200
Docker services aren't healthy yet. Run `docker compose ps` and wait for all services to show `healthy`.

### Elasticsearch takes too long to start
Elasticsearch requires ~30–60 seconds to become healthy on first run. The API will retry the connection automatically.

### Port already in use
```bash
# Kill the process on a specific port
lsof -ti:4000 | xargs kill -9
lsof -ti:5173 | xargs kill -9
```

### First `npm install` shows warnings about install scripts
Approve them with:
```bash
cd backend
npm install-scripts approve @prisma/client
npm install-scripts approve prisma
npm install-scripts approve @prisma/engines
npm install-scripts approve esbuild
```

---

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | No | `development` | Runtime environment |
| `PORT` | No | `4000` | API server port |
| `FRONTEND_URL` | No | `http://localhost:5173` | CORS allowed origin |
| `BACKEND_URL` | No | `http://localhost:4000` | Used in email links |
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `REDIS_URL` | Yes | — | Redis connection string |
| `ELASTICSEARCH_URL` | Yes | — | Elasticsearch base URL |
| `SESSION_SECRET` | Yes | — | ≥32 chars random string |
| `ENCRYPTION_KEY` | Yes | — | Exactly 64 hex chars |
| `GOOGLE_CLIENT_ID` | **Yes** | — | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | **Yes** | — | Google OAuth client secret |
| `SLACK_CLIENT_ID` | No | — | Slack app client ID |
| `SLACK_CLIENT_SECRET` | No | — | Slack app client secret |
| `SLACK_REDIRECT_URL` | No | — | Slack OAuth redirect URL |
| `ADMIN_EMAILS` | No | `""` | Comma-separated emails for Bull Board access |
| `WORKER_CONCURRENCY` | No | `5` | Parallel email sends per worker |
| `MIN_DELAY_MS` | No | `2000` | Min gap between sends (ms) |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | No | `200` | Hourly send limit per sender |
