# Amber

Private Nuxt 4 + Nuxt UI conversational assistant with web and Telegram interfaces, Convex permanent memory, and optional OpenRouter text-to-speech with Fish Audio voice cloning.

## Stack

- Nuxt 4 + Nitro server routes
- Nuxt UI
- Convex (database + serverless functions)
- Telegram Bot API
- Google Gemini API (default model: gemini-2.5-pro)
- OpenRouter TTS API (default model: Fish Audio S2.1 Pro)

## Environment

Copy `.env.example` to `.env` and fill values:

- `NUXT_CONVEX_DEPLOYMENT`
- `NUXT_PUBLIC_CONVEX_URL`
- `NUXT_TELEGRAM_BOT_TOKEN`
- `NUXT_TELEGRAM_ALLOWED_ID`
- `NUXT_GEMINI_API_KEY`
- optional: `NUXT_GEMINI_MODEL`, `NUXT_GEMINI_BASE_URL`, `NUXT_SYSTEM_PROMPT`
- `NUXT_BOT_USERNAME` as the shared Telegram/web memory identity
- `NUXT_OPENROUTER_API_KEY` to enable generated speech
- `NUXT_OPENROUTER_TTS_REFERENCE_ASSET` for the clone reference filename under `server/assets/`
- optional: `NUXT_OPENROUTER_BASE_URL`, `NUXT_OPENROUTER_TTS_MODEL`, `NUXT_OPENROUTER_TTS_REFERENCE_TEXT`, `NUXT_OPENROUTER_TTS_VOICE`

Put the reference clip at `server/assets/voice-reference.mp3` (or configure another filename). MP3, WAV, FLAC, M4A, and OGG are accepted, with a maximum decoded size of 15 MiB. For the best cloning result, set `NUXT_OPENROUTER_TTS_REFERENCE_TEXT` to the clip's exact transcript. Nitro bundles this directory as a private server asset; it is not exposed as a public URL.

## Local Development

1. Install dependencies:

   `pnpm install`

2. Initialize Convex project and generate code:

   `npx convex dev`

3. Run Nuxt + Convex together:

   `pnpm dev:all`

   For Moon on port 3011 using `.env.moon`, run `pnpm dev:moon:all`.
   `pnpm dev` and `pnpm dev:moon` start only Nuxt; they do not sync Convex functions.
   Both combined commands use the Convex CLI deployment configured by `convex dev`.
   Its `CONVEX_DEPLOYMENT` (usually in `.env.local`) must match the app's
   `NUXT_PUBLIC_CONVEX_URL`. `NUXT_CONVEX_DEPLOYMENT` alone does not configure the CLI.

   If chat reports `Could not find public function for 'chat:createWebSession'`,
   sync the backend with `pnpm exec convex dev --once`, then retry the message.

4. Telegram webhook endpoint:

   `POST /api/telegram/webhook`

## Convex Functions

- Schema: `convex/schema.ts`
- Chat logic (sessions/messages queries and mutations): `convex/chat.ts`

## Web Chat

The conversational interface lives at `/chat` and includes:

- shared Telegram and web conversation history
- new web-native sessions stored in the same Convex tables
- optional per-message playback and automatic spoken replies through OpenRouter
- responsive desktop and mobile layouts

The app does not include application-level authentication. Keep the service on a trusted private network or protect it at the Cloud Run/IAP layer.

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

- Deploy Convex first, then Cloud Run in one command:

  `.\scripts\deploy-gcp.ps1 -DeployConvex`

- Specify project/region/service name explicitly:

  `.\scripts\deploy-gcp.ps1 -ProjectId "my-project" -Region "us-central1" -ServiceName "amber-web-prod"`

- Build with Cloud Build and show commands without executing:

  `.\scripts\deploy-gcp.ps1 -UseCloudBuild -DryRun`

If you change files under `convex/`, you need to deploy Convex as well. Deploying only Cloud Run can leave the web app calling Convex functions that do not exist in the live Convex backend yet.
