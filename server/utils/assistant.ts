import { makeFunctionReference } from "convex/server";
import type { ServerConvex } from "./convex";

type ChatRole = "user" | "assistant" | "system";

type StoredMessage = {
	role: ChatRole;
	content: string;
	createdAt: number;
};

type GeminiResponse = {
	candidates?: Array<{
		content?: {
			parts?: Array<{ text?: string }>;
		};
	}>;
};

type AssistantConfig = {
	geminiApiKey: string;
	geminiModel: string;
	geminiBaseUrl: string;
	systemPrompt?: string;
	botUsername?: string;
};

type RunAssistantTurnOptions = {
	convexClient: ServerConvex;
	sessionId: string;
	userText: string;
	config: AssistantConfig;
};

const getSessionHistoryRef = makeFunctionReference<
	"query",
	{ sessionId: string; limit?: number },
	StoredMessage[]
>("chat:getSessionHistory");

const saveMessageRef = makeFunctionReference<
	"mutation",
	{ sessionId: string; role: ChatRole; content: string; createdAt: number },
	string
>("chat:saveMessage");

const getBotMemoriesRef = makeFunctionReference<
	"query",
	{ botUsername: string },
	Array<{ botUsername: string; content: string; createdAt: number }>
>("memory:getBotMemories");

const saveMemoryRef = makeFunctionReference<
	"mutation",
	{ botUsername: string; content: string; createdAt: number },
	string
>("memory:saveMemory");

const getSessionSystemPromptRef = makeFunctionReference<
	"query",
	{ sessionId: string },
	string | null
>("chat:getSessionSystemPrompt");

const setSessionSystemPromptRef = makeFunctionReference<
	"mutation",
	{ sessionId: string; systemPromptSnapshot: string },
	null
>("chat:setSessionSystemPrompt");

// This instruction is shared by every interface so Telegram and web sessions
// use the same long-term memory protocol.
const BASE_SYSTEM_PROMPT = `
當我要你整理記憶時，用<memory> </memory>標籤包裹你要記錄的內容
`.trim();

const RESPONSE_LANGUAGE_INSTRUCTION =
	"請一律使用自然、流暢的繁體中文回答。除非使用者明確要求其他語言，否則不要切換語言。";

function isValidRole(value: string): value is ChatRole {
	return value === "user" || value === "assistant" || value === "system";
}

async function getSystemPrompt(
	convexClient: ServerConvex,
	sessionId: string,
	config: AssistantConfig,
) {
	let fullSystemPrompt = await convexClient.query(getSessionSystemPromptRef, {
		sessionId,
	});

	if (fullSystemPrompt !== null) {
		return fullSystemPrompt;
	}

	const extraPrompt = config.systemPrompt?.trim() ?? "";
	fullSystemPrompt = extraPrompt
		? `${BASE_SYSTEM_PROMPT}\n\n${extraPrompt}`
		: BASE_SYSTEM_PROMPT;

	if (config.botUsername) {
		const memories = await convexClient.query(getBotMemoriesRef, {
			botUsername: config.botUsername,
		});

		if (memories.length > 0) {
			const memoryBlock = memories
				.map((memory) => {
					const date = new Date(memory.createdAt).toISOString().split("T")[0];
					return `[${date}] ${memory.content}`;
				})
				.join("\n");

			fullSystemPrompt += `\n\n--- Long-term memories ---\n${memoryBlock}\n---`;
		}
	}

	await convexClient.mutation(setSessionSystemPromptRef, {
		sessionId,
		systemPromptSnapshot: fullSystemPrompt,
	});

	return fullSystemPrompt;
}

async function persistMemories(
	convexClient: ServerConvex,
	botUsername: string | undefined,
	assistantText: string,
) {
	if (!botUsername) return;

	const memoryPattern = /<memory>([\s\S]*?)<\/memory>/gi;
	for (const match of assistantText.matchAll(memoryPattern)) {
		const content = match[1]?.trim();
		if (!content) continue;

		await convexClient.mutation(saveMemoryRef, {
			botUsername,
			content,
			createdAt: Date.now(),
		});
	}
}

export async function runAssistantTurn({
	convexClient,
	sessionId,
	userText,
	config,
}: RunAssistantTurnOptions) {
	const normalizedText = userText.trim();
	if (!normalizedText) {
		throw new Error("Message cannot be empty.");
	}

	const history = await convexClient.query(getSessionHistoryRef, {
		sessionId,
		limit: 100,
	});

	const contents: Array<{
		role: "user" | "model";
		parts: Array<{ text: string }>;
	}> = [];

	for (const message of history) {
		if (!isValidRole(message.role) || message.role === "system") continue;
		contents.push({
			role: message.role === "assistant" ? "model" : "user",
			parts: [{ text: message.content }],
		});
	}

	contents.push({ role: "user", parts: [{ text: normalizedText }] });

	const sessionSystemPrompt = await getSystemPrompt(
		convexClient,
		sessionId,
		config,
	);
	const fullSystemPrompt = `${sessionSystemPrompt}\n\n${RESPONSE_LANGUAGE_INSTRUCTION}`;

	const response = await fetch(
		`${config.geminiBaseUrl}/models/${encodeURIComponent(config.geminiModel)}:generateContent?key=${encodeURIComponent(config.geminiApiKey)}`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				contents,
				systemInstruction: {
					parts: [{ text: fullSystemPrompt }],
				},
			}),
		},
	);

	if (!response.ok) {
		const details = await response.text();
		console.error(`[assistant] Gemini request failed: ${details}`);
		throw new Error("The model could not generate a response.");
	}

	const responseJson = (await response.json()) as GeminiResponse;
	const assistantText =
		responseJson.candidates?.[0]?.content?.parts
			?.map((part) => part.text ?? "")
			.join("\n")
			.trim() || "抱歉，我目前無法產生回覆。";

	const createdAt = Date.now();
	await convexClient.mutation(saveMessageRef, {
		sessionId,
		role: "user",
		content: normalizedText,
		createdAt,
	});
	await convexClient.mutation(saveMessageRef, {
		sessionId,
		role: "assistant",
		content: assistantText,
		createdAt: createdAt + 1,
	});

	await persistMemories(
		convexClient,
		config.botUsername,
		assistantText,
	);

	return { assistantText, createdAt: createdAt + 1 };
}
