// Keeps signed-out visitors on /login. Data stays protected regardless:
// Convex rejects requests without a valid token.
export default defineNuxtRouteMiddleware(async (to) => {
	const { signedIn } = await useRequestFetch()<{ signedIn: boolean }>(
		"/api/auth/session",
	).catch(() => ({ signedIn: false }));

	if (to.path === "/login") {
		return signedIn ? navigateTo("/") : undefined;
	}
	if (!signedIn) {
		return navigateTo({ path: "/login", query: { redirect: to.fullPath } });
	}
});
