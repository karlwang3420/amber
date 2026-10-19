import type { AuthConfig } from "convex/server";

// Browsers sign in through Nuxt, which mints short-lived ES256 JWTs
// (server/utils/auth.ts). AMBER_AUTH_JWKS holds the matching public key as a
// data URI, so Convex never has to reach the Nuxt server to verify tokens.
// Run `node scripts/setup-auth.mjs` to generate and set it.
export default {
	providers: [
		{
			type: "customJwt",
			applicationID: "amber",
			issuer: "https://amber.invalid",
			jwks: process.env.AMBER_AUTH_JWKS!,
			algorithm: "ES256",
		},
	],
} satisfies AuthConfig;
