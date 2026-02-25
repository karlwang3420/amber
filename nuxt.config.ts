// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
	compatibilityDate: "2025-02-24",
	future: {
		compatibilityVersion: 4,
	},
	devtools: { enabled: true },
	modules: ["@nuxt/ui", "@nuxt/eslint"],
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
		public: {
			convexUrl: process.env.NUXT_PUBLIC_CONVEX_URL,
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
