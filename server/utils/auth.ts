import { Buffer } from "node:buffer";
import {
	createHash,
	createPrivateKey,
	createPublicKey,
	sign,
	timingSafeEqual,
	type KeyObject,
} from "node:crypto";
import type { H3Event } from "h3";

// Must match convex/auth.config.ts.
const CONVEX_TOKEN_ISSUER = "https://amber.invalid";
const CONVEX_TOKEN_AUDIENCE = "amber";
const CONVEX_TOKEN_TTL_SECONDS = 60 * 60;

const SESSION_NAME = "amber-session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

type AmberSession = {
	signedInAt?: number;
};

export function safeEqual(received: string, expected: string) {
	// Hash first so the comparison is constant-time regardless of length.
	const receivedDigest = createHash("sha256").update(received).digest();
	const expectedDigest = createHash("sha256").update(expected).digest();
	return timingSafeEqual(receivedDigest, expectedDigest);
}

export function useAuthSession(event: H3Event) {
	const password = String(useRuntimeConfig(event).sessionPassword || "");
	if (password.length < 32) {
		throw createError({
			statusCode: 503,
			statusMessage: "NUXT_SESSION_PASSWORD must be at least 32 characters.",
		});
	}

	return useSession<AmberSession>(event, {
		name: SESSION_NAME,
		password,
		maxAge: SESSION_MAX_AGE_SECONDS,
		cookie: {
			httpOnly: true,
			sameSite: "lax",
			secure: !import.meta.dev,
			path: "/",
		},
	});
}

export async function isSignedIn(event: H3Event) {
	const session = await useAuthSession(event);
	return typeof session.data.signedInAt === "number";
}

export async function requireAuth(event: H3Event) {
	if (!(await isSignedIn(event))) {
		throw createError({ statusCode: 401, statusMessage: "Sign in required." });
	}
}

/** RFC 7638 thumbprint; scripts/setup-auth.mjs derives the same key ID. */
function jwkThumbprint(jwk: {
	crv?: string;
	kty?: string;
	x?: string;
	y?: string;
}) {
	const canonical = JSON.stringify({
		crv: jwk.crv,
		kty: jwk.kty,
		x: jwk.x,
		y: jwk.y,
	});
	return createHash("sha256").update(canonical).digest("base64url");
}

let signingKey: { encoded: string; key: KeyObject; kid: string } | undefined;

function loadSigningKey(encoded: string) {
	if (signingKey?.encoded === encoded) return signingKey;

	const key = createPrivateKey({
		key: Buffer.from(encoded, "base64"),
		format: "der",
		type: "pkcs8",
	});
	const kid = jwkThumbprint(createPublicKey(key).export({ format: "jwk" }));
	signingKey = { encoded, key, kid };
	return signingKey;
}

function encodeSegment(value: object) {
	return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/** Mints the ES256 JWT that browsers hand to Convex. */
export function mintConvexToken(event: H3Event) {
	const encodedKey = String(useRuntimeConfig(event).authJwtPrivateKey || "");
	if (!encodedKey) {
		throw createError({
			statusCode: 503,
			statusMessage: "NUXT_AUTH_JWT_PRIVATE_KEY is not configured.",
		});
	}

	const { key, kid } = loadSigningKey(encodedKey);
	const issuedAt = Math.floor(Date.now() / 1000);
	const signingInput = [
		encodeSegment({ alg: "ES256", typ: "JWT", kid }),
		encodeSegment({
			iss: CONVEX_TOKEN_ISSUER,
			aud: CONVEX_TOKEN_AUDIENCE,
			sub: "owner",
			iat: issuedAt,
			exp: issuedAt + CONVEX_TOKEN_TTL_SECONDS,
		}),
	].join(".");
	const signature = sign("sha256", Buffer.from(signingInput), {
		key,
		dsaEncoding: "ieee-p1363",
	});

	return `${signingInput}.${signature.toString("base64url")}`;
}
