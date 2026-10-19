import { convexVue, useConvexClient } from "convex-vue";

export default defineNuxtPlugin((nuxtApp) => {
	const runtimeConfig = useRuntimeConfig();
	const convexUrl = runtimeConfig.public.convexUrl;

	if (!convexUrl) {
		return;
	}

	nuxtApp.vueApp.use(convexVue, {
		url: convexUrl,
		// Convex functions require a signed-in user, and server-side rendering
		// has no token, so queries only run in the browser.
		server: false,
	});

	if (import.meta.client) {
		const client = nuxtApp.vueApp.runWithContext(() => useConvexClient());
		client.setAuth(async () => {
			try {
				const { token } = await $fetch<{ token: string | null }>(
					"/api/auth/token",
				);
				return token;
			} catch {
				return null;
			}
		});
	}
});
