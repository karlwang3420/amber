import type { Auth } from "convex/server";
import { ConvexError } from "convex/values";

// Every Convex function is reachable by anyone who knows the deployment URL,
// so each one must check its caller. Nuxt server routes pass the shared
// AMBER_SERVER_SECRET; signed-in browsers carry a JWT minted by Nuxt
// (see auth.config.ts).

function constantTimeEqual(a: string, b: string) {
	let mismatch = a.length ^ b.length;
	for (let index = 0; index < Math.max(a.length, b.length); index++) {
		mismatch |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
	}
	return mismatch === 0;
}

export function requireServerSecret(serverSecret: string) {
	const expected = process.env.AMBER_SERVER_SECRET;
	if (!expected) {
		throw new Error("AMBER_SERVER_SECRET is not set on this Convex deployment.");
	}
	if (!constantTimeEqual(serverSecret, expected)) {
		throw new ConvexError("Unauthorized");
	}
}

export async function requireUser(ctx: { auth: Auth }) {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) {
		throw new ConvexError("Unauthorized");
	}
	return identity;
}

/** For functions shared by Nuxt server routes and signed-in browsers. */
export async function requireServerOrUser(
	ctx: { auth: Auth },
	serverSecret: string | undefined,
) {
	if (serverSecret !== undefined) {
		requireServerSecret(serverSecret);
		return;
	}
	await requireUser(ctx);
}
