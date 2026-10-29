# Chessverse Deployment Guide (Render + Vercel)

This repository is an **npm workspace monorepo**. You **DO NOT** need to publish `@chessverse/contracts` to npm! Both Vercel and Render support monorepo setups natively and link the contracts package automatically.

---

## 1. Backend Deployment on Render

### Step-by-Step Instructions:
1. Log in to your [Render Dashboard](https://dashboard.render.com/).
2. Click **New +** -> **Web Service**.
3. Connect your GitHub repository (`Chessverse`).
4. Configure the service:
   - **Name:** `chessverse-api`
   - **Language / Runtime:** `Node`
   - **Branch:** `main`
   - **Root Directory:** *(leave blank / default root `.`)*
   - **Build Command:** `npm install && npm run build --workspace=@chessverse/api`
   - **Start Command:** `npm run start --workspace=@chessverse/api`
5. Environment Variables:
   - `NODE_ENV`: `production`
   - `PORT`: `10000`
   - `DATABASE_URL`: Your PostgreSQL connection string (Render Postgres, Supabase, or Neon)
   - `REDIS_URL`: *(Optional)* Redis connection string (Upstash or Render Redis)
   - `AUTH_SECRET`: A secure 32+ character secret string for HMAC tokens
   - `FRONTEND_ORIGIN`: Your Vercel frontend URL (e.g. `https://chessverse.vercel.app`)
6. Health Check Path: `/health`
7. Click **Create Web Service**.

> **Note on `@chessverse/contracts`:** Because Render runs `npm install` from the repository root, npm automatically symlinks `@chessverse/contracts` into `apps/api/node_modules/@chessverse/contracts`. It builds cleanly with zero npm registry steps required.

---

## 2. Frontend Deployment on Vercel

### Step-by-Step Instructions:
1. Log in to your [Vercel Dashboard](https://vercel.com/dashboard).
2. Click **Add New...** -> **Project**.
3. Import your GitHub repository (`Chessverse`).
4. In Project Settings:
   - **Framework Preset:** `Vite`
   - **Root Directory:** `./` *(leave as root so Vercel accesses both `apps/web` and `packages/contracts`)*
   - **Build Command:** `npm run build --workspace=@chessverse/web` *(already configured in `vercel.json`)*
   - **Output Directory:** `apps/web/dist` *(already configured in `vercel.json`)*
   - **Install Command:** `npm install`
5. Environment Variables:
   - `VITE_API_BASE_URL`: Your Render backend service URL (e.g. `https://chessverse-api.onrender.com`)
6. Click **Deploy**.

---

## 3. Local Verification

To test the exact production builds locally before pushing:
```bash
# 1. Typecheck all workspaces
npm run typecheck

# 2. Run all tests (Contracts + API + Web)
npm run test

# 3. Build all workspaces
npm run build
```
Everything will compile to `dist/` ready for production.
