// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
	compatibilityDate: "2025-02-24",
	future: {
		compatibilityVersion: 4,
	},
	devtools: { enabled: true },
	modules: ["@nuxt/ui", "@nuxt/eslint"],
	runtimeConfig: {
		convexDeployment: process.env.CONVEX_DEPLOYMENT,
		telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
		telegramAllowedId: process.env.TELEGRAM_ALLOWED_ID,
		geminiApiKey: process.env.GEMINI_API_KEY,
		geminiModel:
			process.env.DEFAULT_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-pro",
		geminiBaseUrl:
			process.env.GEMINI_BASE_URL ||
			"https://generativelanguage.googleapis.com/v1beta",
		systemPrompt: process.env.SYSTEM_PROMPT || "",
		public: {
			convexUrl:
				process.env.NEXT_PUBLIC_CONVEX_URL ||
				process.env.VITE_CONVEX_URL ||
				process.env.CONVEX_URL,
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
