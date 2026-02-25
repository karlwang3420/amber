import { convexVue } from "convex-vue";

export default defineNuxtPlugin((nuxtApp) => {
	const runtimeConfig = useRuntimeConfig();
	const convexUrl = runtimeConfig.public.convexUrl;

	if (!convexUrl) {
		return;
	}

	nuxtApp.vueApp.use(convexVue, {
		url: convexUrl,
	});
});
