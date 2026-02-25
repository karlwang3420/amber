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

- `NUXT_CONVEX_DEPLOYMENT`
- `NUXT_PUBLIC_CONVEX_URL`
- `NUXT_TELEGRAM_BOT_TOKEN`
- `NUXT_TELEGRAM_ALLOWED_ID`
- `NUXT_GEMINI_API_KEY`
- optional: `NUXT_GEMINI_MODEL`, `NUXT_GEMINI_BASE_URL`, `NUXT_SYSTEM_PROMPT`

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

### Deploy to Google Cloud Run

From the project root, you can deploy Amber to Cloud Run using the PowerShell script:

- Basic deploy (uses current `gcloud` project and region default):

  `.\scripts\deploy-gcp.ps1`

- Specify project/region/service name explicitly:

  `.\scripts\deploy-gcp.ps1 -ProjectId "my-project" -Region "us-central1" -ServiceName "amber-web-prod"`

- Build with Cloud Build and show commands without executing:

  `.\scripts\deploy-gcp.ps1 -UseCloudBuild -DryRun`
