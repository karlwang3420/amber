import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

type ChatRole = "user" | "assistant" | "system";

type StoredMessage = {
	role: ChatRole;
	content: string;
	createdAt: number;
};

type GeminiResponse = {
	candidates?: Array<{
		content?: {
			parts?: Array<{
				text?: string;
			}>;
		};
	}>;
};

type TelegramUpdate = {
	message?: {
		chat?: {
			id?: number;
		};
		message_thread_id?: number;
		text?: string;
	};
};

const createOrGetSessionRef = makeFunctionReference<
	"mutation",
	{ telegramChatId: number; title?: string; botUsername?: string },
	string
>("chat:createOrGetSession");

const saveMessageRef = makeFunctionReference<
	"mutation",
	{ sessionId: string; role: ChatRole; content: string; createdAt: number },
	string
>("chat:saveMessage");

const getSessionHistoryRef = makeFunctionReference<
	"query",
	{ sessionId: string; limit?: number },
	StoredMessage[]
>("chat:getSessionHistory");

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

// Core system prompt — edit here directly instead of using .env
// to avoid backslash escaping issues with dotenv.
const SYSTEM_PROMPT = `
當我要你整理記憶時，用<memory> </memory>標籤包裹你要記錄的內容
`.trim();

function isValidRole(value: string): value is ChatRole {
	return value === "user" || value === "assistant" || value === "system";
}

async function sendTelegramMessage(
	botToken: string,
	chatId: number,
	text: string,
	threadId?: number,
) {
	await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			chat_id: chatId,
			...(threadId !== undefined ? { message_thread_id: threadId } : {}),
			text,
		}),
	});
}

export default defineEventHandler(async (event) => {
	const runtimeConfig = useRuntimeConfig(event);

	const botToken = runtimeConfig.telegramBotToken;
	const allowedIdRaw = runtimeConfig.telegramAllowedId;
	const geminiApiKey = runtimeConfig.geminiApiKey;
	const geminiModel = runtimeConfig.geminiModel;
	const geminiBaseUrl = runtimeConfig.geminiBaseUrl;
	const systemPrompt = runtimeConfig.systemPrompt;
	const botUsername = runtimeConfig.botUsername;
	const convexUrl = runtimeConfig.public.convexUrl;

	if (!botToken || !allowedIdRaw || !geminiApiKey || !convexUrl) {
		setResponseStatus(event, 500);
		return { ok: false, error: "Missing required environment configuration" };
	}

	const geminiApiKeyValue = String(geminiApiKey);
	const geminiModelValue = String(geminiModel || "gemini-2.5-pro");
	const geminiBaseUrlValue = String(
		geminiBaseUrl || "https://generativelanguage.googleapis.com/v1beta",
	);

	const allowedId = Number(allowedIdRaw);
	if (!Number.isFinite(allowedId)) {
		setResponseStatus(event, 500);
		return { ok: false, error: "Invalid TELEGRAM_ALLOWED_ID" };
	}

	const body = await readBody<TelegramUpdate>(event);
	const chatId = body?.message?.chat?.id;
	const threadId = body?.message?.message_thread_id;
	const incomingText = body?.message?.text;

	if (
		typeof chatId !== "number" ||
		typeof incomingText !== "string" ||
		incomingText.trim().length === 0
	) {
		return { ok: true, ignored: true };
	}

	if (chatId !== allowedId) {
		setResponseStatus(event, 403);
		return { ok: false, error: "Forbidden chat id" };
	}

	const convexClient = new ConvexHttpClient(convexUrl);
	const normalizedText = incomingText.trim();

	const sessionId = await convexClient.mutation(createOrGetSessionRef, {
		telegramChatId: chatId,
		...(botUsername ? { botUsername: String(botUsername) } : {}),
	});

	const history = await convexClient.query(getSessionHistoryRef, {
		sessionId,
		limit: 30,
	});

	await convexClient.mutation(saveMessageRef, {
		sessionId,
		role: "user",
		content: normalizedText,
		createdAt: Date.now(),
	});

	const contents: Array<{
		role: "user" | "model";
		parts: Array<{ text: string }>;
	}> = [];

	for (const message of history) {
		if (!isValidRole(message.role) || message.role === "system") {
			continue;
		}

		contents.push({
			role: message.role === "assistant" ? "model" : "user",
			parts: [{ text: message.content }],
		});
	}

	contents.push({ role: "user", parts: [{ text: normalizedText }] });

	// Build systemInstruction: base constant + optional env override (append)
	const envPromptExtra =
		typeof systemPrompt === "string" ? systemPrompt.trim() : "";
	let fullSystemPrompt = envPromptExtra
		? `${SYSTEM_PROMPT}\n\n${envPromptExtra}`
		: SYSTEM_PROMPT;

	if (botUsername) {
		const memories = await convexClient.query(getBotMemoriesRef, {
			botUsername: String(botUsername),
		});

		if (memories.length > 0) {
			const memoryBlock = memories
				.map((m) => {
					const date = new Date(m.createdAt).toISOString().split("T")[0];
					return `[${date}] ${m.content}`;
				})
				.join("\n");

			fullSystemPrompt += `\n\n--- Long-term memories ---\n${memoryBlock}\n---`;
		}
	}

	const llmResponse = await fetch(
		`${geminiBaseUrlValue}/models/${encodeURIComponent(geminiModelValue)}:generateContent?key=${encodeURIComponent(geminiApiKeyValue)}`,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				contents,
				...(fullSystemPrompt.length > 0
					? {
							systemInstruction: {
								parts: [{ text: fullSystemPrompt }],
							},
						}
					: {}),
			}),
		},
	);

	if (!llmResponse.ok) {
		const errorText = await llmResponse.text();
		await sendTelegramMessage(
			botToken,
			chatId,
			"Amber failed to contact the model. Please try again.",
			threadId,
		);
		setResponseStatus(event, 502);
		return {
			ok: false,
			error: "LLM request failed",
			detail: errorText,
		};
	}

	const llmJson = (await llmResponse.json()) as GeminiResponse;
	const assistantText =
		llmJson.candidates?.[0]?.content?.parts
			?.map((part) => part.text || "")
			.join("\n")
			.trim() || "I could not generate a response.";

	await convexClient.mutation(saveMessageRef, {
		sessionId,
		role: "assistant",
		content: assistantText,
		createdAt: Date.now(),
	});

	// Extract <memory> tags and persist as long-term memories
	if (botUsername) {
		const memoryRegex = /<memory>([\s\S]*?)<\/memory>/g;
		let match: RegExpExecArray | null;
		while ((match = memoryRegex.exec(assistantText)) !== null) {
			const memoryContent = (match[1] ?? "").trim();
			if (memoryContent.length > 0) {
				await convexClient.mutation(saveMemoryRef, {
					botUsername: String(botUsername),
					content: memoryContent,
					createdAt: Date.now(),
				});
			}
		}
	}

	await sendTelegramMessage(botToken, chatId, assistantText, threadId);

	return { ok: true };
});
