import { Buffer } from "node:buffer";
import { extname } from "node:path";
import { requireAuth } from "../utils/auth";

type SpeechRequest = {
	text?: string;
};

const MAX_REFERENCE_AUDIO_BYTES = 15 * 1024 * 1024;

const AUDIO_MIME_TYPES: Record<string, string> = {
	flac: "audio/flac",
	m4a: "audio/mp4",
	mp3: "audio/mpeg",
	ogg: "audio/ogg",
	wav: "audio/wav",
};

async function loadReferenceAudio(assetName: string) {
	const extension = extname(assetName).slice(1).toLowerCase();
	const mimeType = AUDIO_MIME_TYPES[extension];
	if (!mimeType) {
		throw createError({
			statusCode: 500,
			statusMessage: `Unsupported voice reference format: ${extension || "unknown"}.`,
		});
	}

	const rawAudio = await useStorage("assets:server").getItemRaw(assetName);
	if (rawAudio == null) {
		throw createError({
			statusCode: 503,
			statusMessage: `Voice reference asset is missing: server/assets/${assetName}.`,
		});
	}

	const audio = Buffer.isBuffer(rawAudio)
		? rawAudio
		: Buffer.from(rawAudio as Uint8Array);
	if (!audio.length || audio.length > MAX_REFERENCE_AUDIO_BYTES) {
		throw createError({
			statusCode: 500,
			statusMessage: "Voice reference audio must be between 1 byte and 15 MiB.",
		});
	}

	return {
		data: `data:${mimeType};base64,${audio.toString("base64")}`,
		format: extension,
	};
}

function prepareSpeechText(value: string) {
	return value
		.replace(/<memory>[\s\S]*?<\/memory>/gi, "")
		.replace(/```[\s\S]*?```/g, " Code omitted. ")
		.replace(/\[([^\]]+)]\([^\s)]+\)/g, "$1")
		.replace(/^#{1,6}\s+/gm, "")
		.replace(/[*_~`>]/g, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

export default defineEventHandler(async (event) => {
	await requireAuth(event);

	const body = await readBody<SpeechRequest>(event);
	const text = prepareSpeechText(body.text ?? "");

	if (!text) {
		throw createError({
			statusCode: 400,
			statusMessage: "Speech text is required.",
		});
	}
	if (text.length > 10_000) {
		throw createError({
			statusCode: 400,
			statusMessage: "Speech text is too long.",
		});
	}

	const runtimeConfig = useRuntimeConfig(event);
	const apiKey = runtimeConfig.openRouterApiKey;
	if (!apiKey) {
		throw createError({
			statusCode: 503,
			statusMessage: "OpenRouter TTS is not configured.",
		});
	}

	const model = String(
		runtimeConfig.openRouterTtsModel || "fish-audio/s2.1-pro",
	);
	const referenceAsset = String(
		runtimeConfig.openRouterTtsReferenceAsset || "voice-reference.mp3",
	);
	const referenceText = String(
		runtimeConfig.openRouterTtsReferenceText || "",
	).trim();
	const referenceAudio = await loadReferenceAudio(referenceAsset);
	const voice = String(runtimeConfig.openRouterTtsVoice || "").trim();
	const baseUrl = String(
		runtimeConfig.openRouterBaseUrl || "https://openrouter.ai/api/v1",
	).replace(/\/$/, "");
	const response = await fetch(`${baseUrl}/audio/speech`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${String(apiKey)}`,
			"Content-Type": "application/json",
			"HTTP-Referer": getRequestURL(event).origin,
			"X-Title": "Amber",
		},
		body: JSON.stringify({
			model,
			input: text,
			response_format: "mp3",
			...(voice ? { voice } : {}),
			input_references: [
				{
					type: "input_audio",
					input_audio: referenceAudio,
				},
				...(referenceText
					? [{ type: "text", text: referenceText }]
					: []),
			],
		}),
	});

	if (!response.ok || !response.body) {
		const details = await response.text();
		console.error(`[speech] OpenRouter request failed: ${details}`);
		throw createError({
			statusCode: 502,
			statusMessage: "Speech generation failed.",
		});
	}

	return new Response(response.body, {
		status: 200,
		headers: {
			"Content-Type": response.headers.get("content-type") || "audio/mpeg",
			"Cache-Control": "private, max-age=3600",
			...(response.headers.get("x-generation-id")
				? { "X-Generation-Id": response.headers.get("x-generation-id")! }
				: {}),
		},
	});
});
