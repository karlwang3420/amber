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
	update_id?: number;
	message?: {
		message_id?: number;
		chat?: {
			id?: number;
		};
		message_thread_id?: number;
		text?: string;
	};
};

const createOrGetSessionRef = makeFunctionReference<
	"mutation",
	{
		telegramChatId: number;
		topicId?: number;
		title?: string;
		botUsername?: string;
	},
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

const getSessionSystemPromptRef = makeFunctionReference<
	"query",
	{ sessionId: string },
	string | null
>("chat:getSessionSystemPrompt");

const setSessionSystemPromptRef = makeFunctionReference<
	"mutation",
	{ sessionId: string; systemPromptSnapshot: string },
	void
>("chat:setSessionSystemPrompt");

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
	// Always return 200 to Telegram to prevent webhook retries.
	// Errors are logged server-side but never cause a non-200 response.
	try {
		return await handleTelegramUpdate(event);
	} catch (error) {
		console.error("[webhook] Unhandled error:", error);
		return { ok: true };
	}
});

// Track recently processed update IDs to prevent duplicate processing on retries
const recentUpdateIds = new Set<number>();
const MAX_RECENT_UPDATES = 200;

async function handleTelegramUpdate(
	event: Parameters<Parameters<typeof defineEventHandler>[0]>[0],
) {
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
		console.error("[webhook] Missing required environment configuration");
		return { ok: true };
	}

	const geminiApiKeyValue = String(geminiApiKey);
	const geminiModelValue = String(geminiModel || "gemini-2.5-pro");
	const geminiBaseUrlValue = String(
		geminiBaseUrl || "https://generativelanguage.googleapis.com/v1beta",
	);

	const allowedId = Number(allowedIdRaw);
	if (!Number.isFinite(allowedId)) {
		console.error("[webhook] Invalid TELEGRAM_ALLOWED_ID");
		return { ok: true };
	}

	const body = await readBody<TelegramUpdate>(event);
	const updateId = body?.update_id;
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

	// Deduplicate: skip if we already processed this update
	if (typeof updateId === "number") {
		if (recentUpdateIds.has(updateId)) {
			console.log(`[webhook] Duplicate update_id ${updateId}, skipping`);
			return { ok: true };
		}
		recentUpdateIds.add(updateId);
		// Evict old entries to prevent unbounded growth
		if (recentUpdateIds.size > MAX_RECENT_UPDATES) {
			const first = recentUpdateIds.values().next().value;
			if (first !== undefined) recentUpdateIds.delete(first);
		}
	}

	if (chatId !== allowedId) {
		return { ok: true };
	}

	const convexClient = new ConvexHttpClient(convexUrl);
	const normalizedText = incomingText.trim();

	const sessionId = await convexClient.mutation(createOrGetSessionRef, {
		telegramChatId: chatId,
		...(threadId !== undefined ? { topicId: threadId } : {}),
		...(botUsername ? { botUsername: String(botUsername) } : {}),
	});

	const history = await convexClient.query(getSessionHistoryRef, {
		sessionId,
		limit: 100, // Increased to ensure mid-session memories don't fall out of context quickly
	});

	// User message is saved to DB only after a successful LLM response
	// to prevent accumulation of unsent messages on API failures.

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

	// Snapshot the full system prompt (base + memories) once per session.
	// On subsequent calls within the same session, reuse the stored snapshot
	// so `systemInstruction` never changes — enabling Gemini implicit caching.
	let fullSystemPrompt = await convexClient.query(getSessionSystemPromptRef, {
		sessionId,
	});

	if (fullSystemPrompt === null) {
		const envPromptExtra =
			typeof systemPrompt === "string" ? systemPrompt.trim() : "";
		fullSystemPrompt = envPromptExtra
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

		await convexClient.mutation(setSessionSystemPromptRef, {
			sessionId,
			systemPromptSnapshot: fullSystemPrompt,
		});
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
		console.error(`[webhook] LLM request failed: ${errorText}`);
		await sendTelegramMessage(
			botToken,
			chatId,
			"Failed to contact the model. Please try again later.",
			threadId,
		);
		return { ok: true };
	}

	const llmJson = (await llmResponse.json()) as GeminiResponse;
	const assistantText =
		llmJson.candidates?.[0]?.content?.parts
			?.map((part) => part.text || "")
			.join("\n")
			.trim() || "I could not generate a response.";

	// Save both user and assistant messages only on success
	await convexClient.mutation(saveMessageRef, {
		sessionId,
		role: "user",
		content: normalizedText,
		createdAt: Date.now(),
	});

	await convexClient.mutation(saveMessageRef, {
		sessionId,
		role: "assistant",
		content: assistantText,
		createdAt: Date.now(),
	});

	// Extract <memory> tags and persist as long-term memories.
	// Uses a start-pointer approach: track the last <memory> open tag position,
	// and when </memory> is found, extract the segment between them.
	// Nested/duplicate <memory> tags move the start pointer forward.
	if (botUsername) {
		let cursor = 0;
		let startPointer: number | null = null;
		const openTag = "<memory>";
		const closeTag = "</memory>";

		while (cursor < assistantText.length) {
			const nextOpen = assistantText.indexOf(openTag, cursor);
			const nextClose = assistantText.indexOf(closeTag, cursor);

			// No more tags at all — done
			if (nextOpen === -1 && nextClose === -1) break;

			// Determine which tag comes first
			const openFirst =
				nextOpen !== -1 && (nextClose === -1 || nextOpen < nextClose);

			if (openFirst) {
				// Found <memory> — set (or move) the start pointer
				startPointer = nextOpen + openTag.length;
				cursor = startPointer;
			} else {
				// Found </memory>
				if (startPointer !== null) {
					const segment = assistantText.slice(startPointer, nextClose).trim();
					if (segment.length > 0) {
						await convexClient.mutation(saveMemoryRef, {
							botUsername: String(botUsername),
							content: segment,
							createdAt: Date.now(),
						});
					}
					startPointer = null;
				}
				cursor = nextClose + closeTag.length;
			}
		}
	}

	await sendTelegramMessage(botToken, chatId, assistantText, threadId);

	return { ok: true };
}
