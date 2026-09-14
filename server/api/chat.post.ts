import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { runAssistantTurn } from "../utils/assistant";

type ChatRequest = {
	sessionId?: string;
	message?: string;
};

const createWebSessionRef = makeFunctionReference<
	"mutation",
	{ title?: string; botUsername?: string },
	string
>("chat:createWebSession");

function makeSessionTitle(message: string) {
	const singleLine = message.replace(/\s+/g, " ").trim();
	return singleLine.length > 52
		? `${singleLine.slice(0, 49).trimEnd()}…`
		: singleLine;
}

export default defineEventHandler(async (event) => {
	const body = await readBody<ChatRequest>(event);
	const message = body.message?.trim() ?? "";

	if (!message) {
		throw createError({ statusCode: 400, statusMessage: "Message is required." });
	}
	if (message.length > 20_000) {
		throw createError({ statusCode: 400, statusMessage: "Message is too long." });
	}

	const runtimeConfig = useRuntimeConfig(event);
	const convexUrl = runtimeConfig.public.convexUrl;
	const geminiApiKey = runtimeConfig.geminiApiKey;

	if (!convexUrl || !geminiApiKey) {
		throw createError({
			statusCode: 503,
			statusMessage: "Amber is missing its Convex or Gemini configuration.",
		});
	}

	const convexClient = new ConvexHttpClient(String(convexUrl));
	const botUsername = runtimeConfig.botUsername
		? String(runtimeConfig.botUsername)
		: undefined;
	let sessionId = body.sessionId?.trim();

	try {
		if (!sessionId) {
			sessionId = await convexClient.mutation(createWebSessionRef, {
				title: makeSessionTitle(message),
				...(botUsername ? { botUsername } : {}),
			});
		}

		const result = await runAssistantTurn({
			convexClient,
			sessionId,
			userText: message,
			config: {
				geminiApiKey: String(geminiApiKey),
				geminiModel: String(runtimeConfig.geminiModel || "gemini-2.5-pro"),
				geminiBaseUrl: String(
					runtimeConfig.geminiBaseUrl ||
						"https://generativelanguage.googleapis.com/v1beta",
				),
				systemPrompt:
					typeof runtimeConfig.systemPrompt === "string"
						? runtimeConfig.systemPrompt
						: undefined,
				botUsername,
			},
		});

		return {
			sessionId,
			message: {
				role: "assistant" as const,
				content: result.assistantText,
				createdAt: result.createdAt,
			},
		};
	} catch (error) {
		console.error("[web-chat] Failed to complete turn:", error);
		throw createError({
			statusCode: 502,
			statusMessage:
				error instanceof Error
					? error.message
					: "The assistant could not respond.",
		});
	}
});
