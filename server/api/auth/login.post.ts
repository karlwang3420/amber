import { safeEqual, useAuthSession } from "../../utils/auth";

type LoginRequest = {
	password?: string;
};

// Amber has a single owner, so failed attempts are throttled globally per
// instance. Cloud Run's X-Forwarded-For can be spoofed, so there is no
// reliable per-client key to throttle on.
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_WINDOW = 10;
let failureWindowStart = 0;
let failureCount = 0;

export default defineEventHandler(async (event) => {
	const expectedPassword = String(useRuntimeConfig(event).authPassword || "");
	if (!expectedPassword) {
		throw createError({
			statusCode: 503,
			statusMessage: "Sign-in is not configured (NUXT_AUTH_PASSWORD).",
		});
	}

	const body = await readBody<LoginRequest>(event);
	const password = typeof body?.password === "string" ? body.password : "";

	// Check the budget only once the body has arrived. Everything from here to
	// the counter update is synchronous, so concurrent requests with slow
	// bodies cannot all pass the check before any failure is counted.
	const now = Date.now();
	if (now - failureWindowStart > FAILURE_WINDOW_MS) {
		failureWindowStart = now;
		failureCount = 0;
	}
	if (failureCount >= MAX_FAILURES_PER_WINDOW) {
		throw createError({
			statusCode: 429,
			statusMessage: "Too many failed attempts. Try again later.",
		});
	}

	if (!safeEqual(password, expectedPassword)) {
		failureCount++;
		await new Promise((resolve) => setTimeout(resolve, 500));
		throw createError({ statusCode: 401, statusMessage: "Wrong password." });
	}

	const session = await useAuthSession(event);
	await session.update({ signedInAt: now });
	return { ok: true };
});
