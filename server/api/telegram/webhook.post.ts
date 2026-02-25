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
		message_thread_id?: number;
		chat?: {
			id?: number;
		};
		text?: string;
	};
};

const createOrGetSessionRef = makeFunctionReference<
	"mutation",
	{ telegramChatId: number; topicId?: number; title?: string },
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

function isValidRole(value: string): value is ChatRole {
	return value === "user" || value === "assistant" || value === "system";
}

async function sendTelegramMessage(
	botToken: string,
	chatId: number,
	text: string,
	options?: { messageThreadId?: number },
) {
	const payload: Record<string, unknown> = {
		chat_id: chatId,
		text,
	};

	if (typeof options?.messageThreadId === "number") {
		payload.message_thread_id = options.messageThreadId;
	}

	await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify(payload),
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
	const incomingText = body?.message?.text;
	const messageThreadId = body?.message?.message_thread_id;
	const topicId =
		typeof messageThreadId === "number" ? messageThreadId : undefined;

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
		topicId,
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

	const llmResponse = await fetch(
		`${geminiBaseUrlValue}/models/${encodeURIComponent(geminiModelValue)}:generateContent?key=${encodeURIComponent(geminiApiKeyValue)}`,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				contents,
				...(typeof systemPrompt === "string" && systemPrompt.trim().length > 0
					? {
							systemInstruction: {
								parts: [{ text: systemPrompt.trim() }],
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
			{ messageThreadId: topicId },
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

	await sendTelegramMessage(botToken, chatId, assistantText, {
		messageThreadId: topicId,
	});

	return { ok: true };
});
