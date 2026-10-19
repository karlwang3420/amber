#!/usr/bin/env node
// Generates Amber's access secrets, writes them into one or more env files,
// and sets the matching variables on the Convex deployment. Secret values are
// never printed; they reach the Convex CLI through stdin.
//
//   node scripts/setup-auth.mjs                         # .env + deployment from .env.local
//   node scripts/setup-auth.mjs --env .env --env .env.moon
//   node scripts/setup-auth.mjs --prod                  # Convex production deployment
//   node scripts/setup-auth.mjs --rotate                # replace existing secrets
//   node scripts/setup-auth.mjs --skip-convex           # only write env files
//
// Env files that share a Convex deployment must share the Convex secret and
// JWT key, so every value is reused across all files given.

import { spawnSync } from "node:child_process";
import {
	createHash,
	createPrivateKey,
	createPublicKey,
	generateKeyPairSync,
	randomBytes,
} from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const envFiles = [];
for (let index = 0; index < args.length; index++) {
	if (args[index] === "--env") envFiles.push(args[++index]);
}
if (envFiles.length === 0) envFiles.push(".env");
const rotate = args.includes("--rotate");
const prod = args.includes("--prod");
const skipConvex = args.includes("--skip-convex");

// Hex secrets never start with "-", so no CLI can mistake one for a flag.
const randomSecret = () => randomBytes(32).toString("hex");

const GENERATED = {
	NUXT_CONVEX_SERVER_SECRET: randomSecret,
	NUXT_SESSION_PASSWORD: randomSecret,
	NUXT_TELEGRAM_WEBHOOK_SECRET: randomSecret,
	NUXT_AUTH_JWT_PRIVATE_KEY: () =>
		generateKeyPairSync("ec", { namedCurve: "P-256" })
			.privateKey.export({ type: "pkcs8", format: "der" })
			.toString("base64"),
};

function readEnv(path) {
	const text = readFileSync(path, "utf8");
	const values = {};
	for (const line of text.split(/\r?\n/)) {
		const match = line.match(/^\s*([A-Z0-9_]+)\s*=(.*)$/);
		if (match) values[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, "$2");
	}
	return { text, values };
}

function writeEnv(path, text, updates) {
	const newline = text.includes("\r\n") ? "\r\n" : "\n";
	const lines = text.split(/\r?\n/);
	for (const [key, value] of Object.entries(updates)) {
		const index = lines.findIndex((line) => line.match(/^\s*([A-Z0-9_]+)\s*=/)?.[1] === key);
		if (index === -1) {
			if (lines.at(-1) === "") lines.pop();
			lines.push(`${key}=${value}`, "");
		} else {
			lines[index] = `${key}=${value}`;
		}
	}
	writeFileSync(path, lines.join(newline));
}

// RFC 7638 thumbprint; must match jwkThumbprint in server/utils/auth.ts.
function jwkThumbprint({ crv, kty, x, y }) {
	return createHash("sha256")
		.update(JSON.stringify({ crv, kty, x, y }))
		.digest("base64url");
}

async function askForPassword() {
	if (!stdin.isTTY) return null;
	const prompt = createInterface({ input: stdin, output: stdout });
	try {
		for (;;) {
			const answer = (
				await prompt.question("Choose a sign-in password (blank = generate one): ")
			).trim();
			if (!answer || answer.length >= 12) return answer || null;
			console.log("Use at least 12 characters.");
		}
	} finally {
		prompt.close();
	}
}

const files = envFiles.map((path) => {
	if (!existsSync(path)) {
		console.error(`Env file not found: ${path}`);
		process.exit(1);
	}
	return { path, ...readEnv(path) };
});

const existing = (key) => files.map((file) => file.values[key]).find(Boolean);
const shared = {};
for (const [key, generate] of Object.entries(GENERATED)) {
	shared[key] = (!rotate && existing(key)) || generate();
}

let generatedPassword = false;
shared.NUXT_AUTH_PASSWORD = existing("NUXT_AUTH_PASSWORD");
if (!shared.NUXT_AUTH_PASSWORD) {
	shared.NUXT_AUTH_PASSWORD = await askForPassword();
	if (!shared.NUXT_AUTH_PASSWORD) {
		shared.NUXT_AUTH_PASSWORD = randomBytes(18).toString("hex");
		generatedPassword = true;
	}
}

for (const file of files) {
	const updates = Object.fromEntries(
		Object.entries(shared).filter(([key, value]) => file.values[key] !== value),
	);
	writeEnv(file.path, file.text, updates);
	const changed = Object.keys(updates);
	console.log(
		changed.length
			? `${file.path}: set ${changed.join(", ")}`
			: `${file.path}: already up to date`,
	);
}
if (generatedPassword) {
	console.log("Generated a sign-in password: see NUXT_AUTH_PASSWORD in the env file.");
}

if (skipConvex) process.exit(0);

const publicJwk = createPublicKey(
	createPrivateKey({
		key: Buffer.from(shared.NUXT_AUTH_JWT_PRIVATE_KEY, "base64"),
		format: "der",
		type: "pkcs8",
	}),
).export({ format: "jwk" });
const jwks = {
	keys: [{ ...publicJwk, kid: jwkThumbprint(publicJwk), alg: "ES256", use: "sig" }],
};

const convexVariables = {
	AMBER_SERVER_SECRET: shared.NUXT_CONVEX_SERVER_SECRET,
	AMBER_AUTH_JWKS: `data:text/plain;charset=utf-8;base64,${Buffer.from(JSON.stringify(jwks)).toString("base64")}`,
};

const convexCli = fileURLToPath(
	new URL("../node_modules/convex/bin/main.js", import.meta.url),
);
console.log(
	prod
		? "Setting Convex variables on the production deployment..."
		: "Setting Convex variables on the deployment in .env.local (CONVEX_DEPLOYMENT)...",
);
for (const [name, value] of Object.entries(convexVariables)) {
	const result = spawnSync(
		process.execPath,
		[convexCli, "env", "set", name, ...(prod ? ["--prod"] : [])],
		{ input: value, encoding: "utf8" },
	);
	if (result.status !== 0) {
		console.error(`Failed to set ${name} on Convex:\n${result.stderr || result.stdout}`);
		process.exit(1);
	}
	console.log(`Convex: set ${name}`);
}
