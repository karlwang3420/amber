<template>
	<div class="flex min-h-screen items-center justify-center bg-gray-950 px-4 text-gray-100">
		<UCard class="w-full max-w-sm border-amber-900/20">
			<form class="space-y-5" @submit.prevent="signIn">
				<div class="flex items-center gap-3">
					<div class="flex size-9 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400">
						<UIcon name="i-lucide-gem" class="size-5" />
					</div>
					<div>
						<h1 class="font-[Fraunces] text-xl font-medium text-amber-50">Amber</h1>
						<p class="text-xs text-gray-500">Sign in to continue</p>
					</div>
				</div>

				<UFormField label="Password" :error="errorMessage || undefined">
					<UInput
						v-model="password"
						type="password"
						autocomplete="current-password"
						autofocus
						class="w-full"
						:disabled="submitting" />
				</UFormField>

				<UButton
					type="submit"
					label="Sign in"
					icon="i-lucide-log-in"
					block
					:loading="submitting"
					:disabled="!password" />
			</form>
		</UCard>
	</div>
</template>

<script setup lang="ts">
	const route = useRoute();
	const password = ref("");
	const submitting = ref(false);
	const errorMessage = ref("");

	// Resolve the target exactly as the browser will before trusting it:
	// "//host", "/\host" or a stripped control character ("/\n/host") would
	// otherwise leave the site.
	function redirectTarget() {
		const target = route.query.redirect;
		if (typeof target !== "string") return "/";
		try {
			const url = new URL(target, window.location.origin);
			return url.origin === window.location.origin
				? `${url.pathname}${url.search}${url.hash}`
				: "/";
		} catch {
			return "/";
		}
	}

	async function signIn() {
		if (!password.value || submitting.value) return;

		submitting.value = true;
		errorMessage.value = "";
		try {
			await $fetch("/api/auth/login", {
				method: "POST",
				body: { password: password.value },
			});
			// Full reload so the Convex client starts with the new session's token.
			window.location.assign(redirectTarget());
		} catch (error: unknown) {
			password.value = "";
			errorMessage.value =
				error && typeof error === "object" && "statusMessage" in error
					? String(error.statusMessage)
					: "Sign-in failed. Please try again.";
			submitting.value = false;
		}
	}
</script>
