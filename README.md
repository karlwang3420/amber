# Amber

Private Nuxt 4 + Nuxt UI Telegram bot backend with Convex as permanent memory storage.

## Stack

- Nuxt 4 + Nitro server routes
- Nuxt UI
- Convex (database + serverless functions)
- Telegram Bot API
- Google Gemini API (default model: gemini-2.5-pro)

## Environment

Copy `.env.example` to `.env` and fill values:

- `CONVEX_DEPLOYMENT`
- `NEXT_PUBLIC_CONVEX_URL`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ALLOWED_ID`
- `GEMINI_API_KEY`
- optional: `DEFAULT_MODEL`, `GEMINI_BASE_URL`, `SYSTEM_PROMPT`

## Local Development

1. Install dependencies:

   `pnpm install`

2. Initialize Convex project and generate code:

   `npx convex dev`

3. Run Nuxt + Convex together:

   `pnpm dev:all`

4. Telegram webhook endpoint:

   `POST /api/telegram/webhook`

## Convex Functions

- Schema: `convex/schema.ts`
- Chat logic (sessions/messages queries and mutations): `convex/chat.ts`

## Dashboard

Admin memory dashboard lives at `/` and includes:

- session sidebar
- full message history viewer
- JSON export for selected session

## Docker / Cloud Run

Build image:

`docker build -t amber .`

Run container:

`docker run -p 3000:3000 --env-file .env amber`

The container starts Nitro with:

`node .output/server/index.mjs`
