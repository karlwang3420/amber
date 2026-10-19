export async function signOut() {
	await $fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
	// Full reload drops the Convex client's cached token.
	window.location.assign("/login");
}
