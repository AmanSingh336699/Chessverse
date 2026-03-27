# Chessverse

Chessverse is split into three local packages:

- `apps/api` for the Fastify + Stockfish backend
- `apps/web` for the React frontend

## Install

Run these commands in order:

1. `cd C:\Users\amans\Chessverse\apps\api`
2. `npm install`
3. `cd ..\web`
4. `npm install`

## Environment

The API auto-loads env values from the repo root in this order:

1. `.env.local`
2. `.env`
3. `.env.example`

`stockfish` is the default engine source through the npm package. `STOCKFISH_PATH` is optional and should only be used when you intentionally want a native binary override.

Opening-book behavior is now simple:

- If `OPENING_BOOK_PATH` is set, the API uses that `.bin` file.
- Otherwise it uses bundled [gm2600.bin](C:/Users/amans/Chessverse/apps/api/assets/opening/gm2600.bin).
- If neither can be loaded, the API continues without an opening book.
- There is no curated in-memory opening-book fallback anymore.

Opening-book status is exposed via `/health` and `/ready`.

`book:generate` only regenerates the legacy curated `chessverse-default.bin` from source lines. It is not needed for normal development when you are using `gm2600.bin`.

## Database

For development against Neon PostgreSQL, run this from the repo root:

1. `npm install --prefix apps/api`
2. `npm run db:push`

Optional Drizzle commands:

- `npm run db:generate`
- `npm run db:studio`

## Run

1. Backend: `cd C:\Users\amans\Chessverse\apps\api && npm install && npm run dev`
2. Frontend: `cd C:\Users\amans\Chessverse\apps\web && npm install && npm run dev`

If you change shared package metadata or see a stale Vite JSON parse overlay, restart the web dev server once.

## Checks

From the repo root you can run:

- `npm run typecheck`
- `npm run build`
- `npm run test`
