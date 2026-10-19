// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
	compatibilityDate: "2025-02-24",
	future: {
		compatibilityVersion: 4,
	},
	devtools: { enabled: true },
	modules: ["@nuxt/ui", "@nuxt/eslint"],
	css: ["~/assets/css/main.css"],
	runtimeConfig: {
		convexDeployment: process.env.NUXT_CONVEX_DEPLOYMENT,
		telegramBotToken: process.env.NUXT_TELEGRAM_BOT_TOKEN,
		telegramAllowedId: process.env.NUXT_TELEGRAM_ALLOWED_ID,
		geminiApiKey: process.env.NUXT_GEMINI_API_KEY,
		geminiModel: process.env.NUXT_GEMINI_MODEL || "gemini-2.5-pro",
		geminiBaseUrl:
			process.env.NUXT_GEMINI_BASE_URL ||
			"https://generativelanguage.googleapis.com/v1beta",
		systemPrompt: process.env.NUXT_SYSTEM_PROMPT || "",
		botUsername:
			process.env.NUXT_BOT_USERNAME ||
			process.env.NUXT_PUBLIC_BOT_USERNAME ||
			"",
		openRouterApiKey: process.env.NUXT_OPENROUTER_API_KEY || "",
		openRouterBaseUrl:
			process.env.NUXT_OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
		openRouterTtsModel:
			process.env.NUXT_OPENROUTER_TTS_MODEL || "fish-audio/s2.1-pro",
		openRouterTtsVoice: process.env.NUXT_OPENROUTER_TTS_VOICE || "",
		openRouterTtsReferenceAsset:
			process.env.NUXT_OPENROUTER_TTS_REFERENCE_ASSET ||
			"voice-reference.mp3",
		openRouterTtsReferenceText:
			process.env.NUXT_OPENROUTER_TTS_REFERENCE_TEXT || "",
		// Access secrets stay empty at build time so they are never baked into
		// .output; Nitro fills them at runtime from the matching NUXT_* variables.
		convexServerSecret: "", // NUXT_CONVEX_SERVER_SECRET
		telegramWebhookSecret: "", // NUXT_TELEGRAM_WEBHOOK_SECRET
		authPassword: "", // NUXT_AUTH_PASSWORD
		sessionPassword: "", // NUXT_SESSION_PASSWORD
		authJwtPrivateKey: "", // NUXT_AUTH_JWT_PRIVATE_KEY
		public: {
			convexUrl: process.env.NUXT_PUBLIC_CONVEX_URL,
			botUsername:
				process.env.NUXT_PUBLIC_BOT_USERNAME ||
				process.env.NUXT_BOT_USERNAME ||
				"",
		},
	},
	nitro: {
		experimental: {
			websocket: true,
		},
		routeRules: {
			"/api/telegram/webhook": {
				headers: { "x-nitro-no-csrf": "true" },
			},
		},
	},
	vite: {
		build: {
			target: "esnext",
		},
		server: {
			allowedHosts: true,
		},
	},
});
