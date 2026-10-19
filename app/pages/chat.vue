<script setup lang="ts">
	import { makeFunctionReference } from "convex/server";
	import { useConvexQuery } from "convex-vue";

	type Session = {
		_id: string;
		_creationTime: number;
		telegramChatId?: number;
		channel?: "telegram" | "web";
		title?: string;
		isActive: boolean;
		lastMessageAt: number;
		messageCount: number;
	};

	type Message = {
		_id: string;
		sessionId: string;
		role: "user" | "assistant" | "system";
		content: string;
		createdAt: number;
	};

	type Memory = {
		_id: string;
		content: string;
		createdAt: number;
	};

	type ChatResponse = {
		sessionId: string;
		message: {
			role: "assistant";
			content: string;
			createdAt: number;
		};
	};

	const runtimeConfig = useRuntimeConfig();
	const botUsername = runtimeConfig.public.botUsername as string;

	const getAllSessionsRef = makeFunctionReference<
		"query",
		{ botUsername?: string },
		Session[]
	>("chat:getAllSessions");
	const getMessagesBySessionRef = makeFunctionReference<
		"query",
		{ sessionId?: string },
		Message[]
	>("chat:getMessagesBySession");
	const getBotMemoriesRef = makeFunctionReference<
		"query",
		{ botUsername: string },
		Memory[]
	>("memory:getBotMemories");

	const { data: sessionsData, isPending: sessionsPending } = useConvexQuery(
		getAllSessionsRef,
		{ botUsername: botUsername || undefined },
	);
	const sessions = computed(() => sessionsData.value ?? []);
	const selectedSessionId = ref<string | null>(null);
	const draftingNewSession = ref(false);
	const mobileSidebarOpen = ref(false);

	watch(
		sessions,
		(nextSessions) => {
			if (draftingNewSession.value) return;
			if (!selectedSessionId.value && nextSessions[0]) {
				selectedSessionId.value = nextSessions[0]._id;
			}
			if (
				selectedSessionId.value &&
				!nextSessions.some((session) => session._id === selectedSessionId.value)
			) {
				selectedSessionId.value = nextSessions[0]?._id ?? null;
			}
		},
		{ immediate: true },
	);

	const selectedSession = computed(
		() =>
			sessions.value.find(
				(session) => session._id === selectedSessionId.value,
			) ?? null,
	);
	const { data: messagesData, isPending: messagesPending } = useConvexQuery(
		getMessagesBySessionRef,
		computed(() => ({
			sessionId: selectedSessionId.value ?? undefined,
		})),
	);
	const messages = computed(() => messagesData.value ?? []);
	const { data: memoriesData, isPending: memoriesPending } = useConvexQuery(
		getBotMemoriesRef,
		{ botUsername },
	);
	const memories = computed(() => memoriesData.value ?? []);

	const draft = ref("");
	const sending = ref(false);
	const pendingUserMessage = ref("");
	const sendError = ref("");
	const messageViewport = ref<HTMLElement | null>(null);
	const composer = ref<HTMLTextAreaElement | null>(null);

	function sessionTitle(session: Session) {
		return (
			session.title?.trim() ||
			(session.telegramChatId
				? `Telegram · ${session.telegramChatId}`
				: "Web conversation")
		);
	}

	function relativeDate(timestamp: number) {
		if (!timestamp) return "No messages";
		const difference = Date.now() - timestamp;
		const minutes = Math.floor(difference / 60_000);
		if (minutes < 1) return "Just now";
		if (minutes < 60) return `${minutes}m ago`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		if (days < 7) return `${days}d ago`;
		return new Date(timestamp).toLocaleDateString(undefined, {
			month: "short",
			day: "numeric",
		});
	}

	function messageTime(timestamp: number) {
		return new Date(timestamp).toLocaleTimeString([], {
			hour: "2-digit",
			minute: "2-digit",
		});
	}

	function selectSession(sessionId: string) {
		selectedSessionId.value = sessionId;
		draftingNewSession.value = false;
		sendError.value = "";
		mobileSidebarOpen.value = false;
	}

	function startNewSession() {
		selectedSessionId.value = null;
		draftingNewSession.value = true;
		draft.value = "";
		sendError.value = "";
		mobileSidebarOpen.value = false;
		nextTick(() => composer.value?.focus());
	}

	async function scrollToBottom(behavior: ScrollBehavior = "smooth") {
		await nextTick();
		messageViewport.value?.scrollTo({
			top: messageViewport.value.scrollHeight,
			behavior,
		});
	}

	watch(
		() => [messages.value.length, pendingUserMessage.value, sending.value],
		() => scrollToBottom(messages.value.length ? "smooth" : "auto"),
	);

	async function sendMessage() {
		const message = draft.value.trim();
		if (!message || sending.value) return;

		sending.value = true;
		sendError.value = "";
		pendingUserMessage.value = message;
		draft.value = "";

		try {
			const response = await $fetch<ChatResponse>("/api/chat", {
				method: "POST",
				body: {
					sessionId: selectedSessionId.value || undefined,
					message,
				},
			});

			selectedSessionId.value = response.sessionId;
			draftingNewSession.value = false;
			pendingUserMessage.value = "";
			if (autoSpeak.value) {
				await speak(response.message.content, `reply-${response.message.createdAt}`);
			}
		} catch (error: unknown) {
			draft.value = message;
			pendingUserMessage.value = "";
			sendError.value =
				error && typeof error === "object" && "statusMessage" in error
					? String(error.statusMessage)
					: "Amber could not answer. Please try again.";
		} finally {
			sending.value = false;
			nextTick(() => composer.value?.focus());
		}
	}

	function handleComposerKeydown(event: KeyboardEvent) {
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			sendMessage();
		}
	}

	const speakingId = ref<string | null>(null);
	const speechLoadingId = ref<string | null>(null);
	const speechError = ref("");
	const autoSpeak = ref(false);
	let currentAudio: HTMLAudioElement | null = null;
	let currentAudioUrl: string | null = null;

	onMounted(() => {
		autoSpeak.value = localStorage.getItem("amber-auto-speak") === "true";
	});

	watch(autoSpeak, (enabled) => {
		if (import.meta.client) {
			localStorage.setItem("amber-auto-speak", String(enabled));
		}
	});

	onBeforeUnmount(() => {
		stopSpeech();
		if (memoryCopyResetTimer) clearTimeout(memoryCopyResetTimer);
	});

	function stopSpeech() {
		currentAudio?.pause();
		currentAudio = null;
		if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
		currentAudioUrl = null;
		speakingId.value = null;
	}

	async function speak(content: string, id: string) {
		if (speakingId.value === id) {
			stopSpeech();
			return;
		}

		stopSpeech();
		speechError.value = "";
		speechLoadingId.value = id;

		try {
			const response = await fetch("/api/speech", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ text: content }),
			});
			if (!response.ok) {
				const payload = (await response.json().catch(() => null)) as {
					statusMessage?: string;
				} | null;
				throw new Error(payload?.statusMessage || "Speech generation failed.");
			}

			const blob = await response.blob();
			currentAudioUrl = URL.createObjectURL(blob);
			currentAudio = new Audio(currentAudioUrl);
			speakingId.value = id;
			currentAudio.addEventListener("ended", stopSpeech, { once: true });
			currentAudio.addEventListener("error", stopSpeech, { once: true });
			await currentAudio.play();
		} catch (error) {
			stopSpeech();
			speechError.value =
				error instanceof Error ? error.message : "Speech generation failed.";
		} finally {
			speechLoadingId.value = null;
		}
	}

	const copiedMessageId = ref<string | null>(null);
	async function copyMessage(message: Message) {
		await navigator.clipboard.writeText(message.content);
		copiedMessageId.value = message._id;
		setTimeout(() => {
			if (copiedMessageId.value === message._id) copiedMessageId.value = null;
		}, 1500);
	}

	type MemoryCopyStatus = "idle" | "copied" | "error";
	const memoryCopyStatus = ref<MemoryCopyStatus>("idle");
	let memoryCopyResetTimer: ReturnType<typeof setTimeout> | undefined;

	function formatMemoryDate(timestamp: number) {
		return new Date(timestamp).toISOString().slice(0, 10);
	}

	async function writeToClipboard(content: string) {
		if (navigator.clipboard?.writeText) {
			try {
				await navigator.clipboard.writeText(content);
				return;
			} catch {
				// Fall back for browsers that block the Clipboard API.
			}
		}

		const textarea = document.createElement("textarea");
		textarea.value = content;
		textarea.setAttribute("readonly", "");
		textarea.style.position = "fixed";
		textarea.style.opacity = "0";
		document.body.appendChild(textarea);
		textarea.select();
		const copied = document.execCommand("copy");
		textarea.remove();

		if (!copied) throw new Error("Clipboard access was denied.");
	}

	async function copyAllMemories() {
		if (memoriesPending.value || memories.value.length === 0) return;

		const content = memories.value
			.map(
				(memory) =>
					`[${formatMemoryDate(memory.createdAt)}] ${memory.content.trim()}`,
			)
			.join("\n\n");

		try {
			await writeToClipboard(content);
			memoryCopyStatus.value = "copied";
		} catch {
			memoryCopyStatus.value = "error";
		}

		if (memoryCopyResetTimer) clearTimeout(memoryCopyResetTimer);
		memoryCopyResetTimer = setTimeout(() => {
			memoryCopyStatus.value = "idle";
		}, 2500);
	}
</script>

<template>
	<div class="chat-shell">
		<div class="ambient-glow ambient-glow-one" />
		<div class="ambient-glow ambient-glow-two" />

		<aside class="session-rail" :class="{ 'session-rail-open': mobileSidebarOpen }">
			<div class="brand-lockup">
				<div class="amber-mark"><span /></div>
				<div>
					<p class="brand-eyebrow">Private correspondence</p>
					<h1>Amber</h1>
				</div>
				<button class="mobile-close" aria-label="Close conversations" @click="mobileSidebarOpen = false">
					<UIcon name="i-lucide-x" />
				</button>
			</div>

			<button class="new-conversation" @click="startNewSession">
				<span class="new-conversation-icon"><UIcon name="i-lucide-feather" /></span>
				<span>Begin a new thought</span>
				<UIcon name="i-lucide-arrow-up-right" class="new-arrow" />
			</button>

			<div class="rail-heading">
				<span>Past conversations</span>
				<span>{{ sessions.length }}</span>
			</div>

			<nav class="session-list" aria-label="Conversation history">
				<div v-if="sessionsPending" class="rail-loading">
					<span v-for="index in 4" :key="index" class="loading-line" />
				</div>
				<button
					v-for="session in sessions"
					:key="session._id"
					class="session-entry"
					:class="{ 'session-entry-active': selectedSessionId === session._id && !draftingNewSession }"
					@click="selectSession(session._id)">
					<span class="session-thread" />
					<span class="session-copy">
						<strong>{{ sessionTitle(session) }}</strong>
						<small>{{ relativeDate(session.lastMessageAt) }} · {{ session.messageCount }} notes</small>
					</span>
					<span class="channel-glyph" :title="session.channel === 'web' ? 'Web' : 'Telegram'">
						<UIcon :name="session.channel === 'web' ? 'i-lucide-monitor' : 'i-lucide-send'" />
					</span>
				</button>
			</nav>

			<div class="rail-footer">
				<button
					class="memory-copy"
					:disabled="memoriesPending || memories.length === 0"
					@click="copyAllMemories">
					<UIcon
						:name="
							memoryCopyStatus === 'copied'
								? 'i-lucide-check'
								: memoryCopyStatus === 'error'
									? 'i-lucide-circle-alert'
									: memoriesPending
										? 'i-lucide-loader-circle'
										: 'i-lucide-copy'
						" />
					<span v-if="memoryCopyStatus === 'copied'">
						{{ memories.length }} memories copied
					</span>
					<span v-else-if="memoryCopyStatus === 'error'">Couldn’t copy memories</span>
					<span v-else-if="memoriesPending">Loading long-term memory</span>
					<span v-else-if="memories.length === 0">No long-term memories yet</span>
					<span v-else>Copy all long-term memories</span>
				</button>
				<NuxtLink to="/" class="vault-link">
					<UIcon name="i-lucide-archive" />
					<span>Open memory vault</span>
				</NuxtLink>
				<button class="vault-link" @click="signOut">
					<UIcon name="i-lucide-log-out" />
					<span>Sign out</span>
				</button>
				<div class="connection-note"><span /> Convex memory connected</div>
			</div>
		</aside>

		<button
			v-if="mobileSidebarOpen"
			class="sidebar-scrim"
			aria-label="Close conversations"
			@click="mobileSidebarOpen = false" />

		<main class="conversation-stage">
			<header class="conversation-header">
				<button class="mobile-menu" aria-label="Open conversations" @click="mobileSidebarOpen = true">
					<UIcon name="i-lucide-panel-left" />
				</button>
				<div class="conversation-identity">
					<span class="chapter-index">{{ draftingNewSession ? "NEW" : "THREAD" }}</span>
					<div>
						<h2>{{ draftingNewSession ? "An unwritten conversation" : selectedSession ? sessionTitle(selectedSession) : "A quiet room" }}</h2>
						<p>{{ selectedSession ? `${selectedSession.messageCount} messages held in memory` : "Begin wherever your mind is" }}</p>
					</div>
				</div>
				<label class="voice-switch" title="Speak new replies automatically">
					<input v-model="autoSpeak" type="checkbox">
					<span class="voice-switch-track"><span /></span>
					<UIcon name="i-lucide-audio-lines" />
					<span>Voice</span>
				</label>
			</header>

			<section ref="messageViewport" class="message-viewport" aria-live="polite">
				<div v-if="messagesPending && selectedSessionId" class="message-loading">
					<div class="orbital-loader"><span /><span /><span /></div>
					<p>Gathering the thread…</p>
				</div>

				<div v-else-if="messages.length === 0 && !pendingUserMessage" class="empty-letter">
					<div class="empty-sigil"><span>✦</span></div>
					<p class="empty-kicker">The page is yours</p>
					<h3>{{ draftingNewSession ? "What would you like to explore?" : "There’s room for a new thought." }}</h3>
					<p class="empty-description">Amber will remember the thread, carry useful context forward, and speak her response when you ask.</p>
					<div class="prompt-starters">
						<button @click="draft = 'Help me think through something that has been on my mind.'; composer?.focus()">Think something through</button>
						<button @click="draft = 'What do you remember about our recent conversations?'; composer?.focus()">Revisit a memory</button>
						<button @click="draft = 'I want to plan my next few days with you.'; composer?.focus()">Make a gentle plan</button>
					</div>
				</div>

				<div v-else class="message-ledger">
					<article
						v-for="message in messages"
						:key="message._id"
						class="message-row"
						:class="`message-${message.role}`">
						<div class="speaker-mark">
							<span v-if="message.role === 'assistant'" class="assistant-gem">✦</span>
							<span v-else-if="message.role === 'user'">You</span>
							<span v-else>Sys</span>
						</div>
						<div class="message-body">
							<div class="message-meta">
								<strong>{{ message.role === "assistant" ? "Amber" : message.role === "user" ? "You" : "System" }}</strong>
								<span>{{ messageTime(message.createdAt) }}</span>
							</div>
							<p>{{ message.content }}</p>
							<div class="message-actions">
								<button v-if="message.role === 'assistant'" :disabled="speechLoadingId === message._id" @click="speak(message.content, message._id)">
									<UIcon :name="speechLoadingId === message._id ? 'i-lucide-loader-circle' : speakingId === message._id ? 'i-lucide-square' : 'i-lucide-volume-2'" :class="{ 'spin-icon': speechLoadingId === message._id }" />
									{{ speakingId === message._id ? "Stop" : speechLoadingId === message._id ? "Preparing voice" : "Listen" }}
								</button>
								<button @click="copyMessage(message)">
									<UIcon :name="copiedMessageId === message._id ? 'i-lucide-check' : 'i-lucide-copy'" />
									{{ copiedMessageId === message._id ? "Copied" : "Copy" }}
								</button>
							</div>
						</div>
					</article>

					<article v-if="pendingUserMessage" class="message-row message-user pending-message">
						<div class="speaker-mark"><span>You</span></div>
						<div class="message-body">
							<div class="message-meta"><strong>You</strong><span>now</span></div>
							<p>{{ pendingUserMessage }}</p>
						</div>
					</article>

					<div v-if="sending" class="amber-thinking">
						<span class="thinking-gem">✦</span>
						<div><i /><i /><i /></div>
						<small>Amber is considering</small>
					</div>
				</div>
			</section>

			<footer class="composer-dock">
				<div v-if="sendError || speechError" class="error-note">
					<UIcon name="i-lucide-circle-alert" />
					<span>{{ sendError || speechError }}</span>
					<button @click="sendError = ''; speechError = ''"><UIcon name="i-lucide-x" /></button>
				</div>
				<div class="composer-frame" :class="{ 'composer-busy': sending }">
					<textarea
						ref="composer"
						v-model="draft"
						rows="1"
						maxlength="20000"
						placeholder="Write what’s on your mind…"
						:disabled="sending"
						@keydown="handleComposerKeydown" />
					<div class="composer-lower">
						<span><kbd>Shift</kbd> + <kbd>Enter</kbd> for a new line</span>
						<button class="send-button" :disabled="!draft.trim() || sending" aria-label="Send message" @click="sendMessage">
							<UIcon :name="sending ? 'i-lucide-loader-circle' : 'i-lucide-arrow-up'" :class="{ 'spin-icon': sending }" />
						</button>
					</div>
				</div>
				<p class="privacy-caption">Stored in Amber’s shared memory · TTS generated through OpenRouter</p>
			</footer>
		</main>
	</div>
</template>

<style scoped>
	.chat-shell {
		--ink: #eee8da;
		--muted: #8f8a7d;
		--amber: #e9a23b;
		--amber-bright: #ffc768;
		--coal: #0c0d0c;
		position: relative;
		display: grid;
		grid-template-columns: 310px minmax(0, 1fr);
		min-height: 100dvh;
		overflow: hidden;
		background: #0b0c0b;
		color: var(--ink);
		font-family: "IBM Plex Sans", sans-serif;
	}
	.chat-shell::before { content: ""; position: fixed; inset: 0; pointer-events: none; opacity: .16; background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 160 160' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.25'/%3E%3C/svg%3E"); }
	.ambient-glow { position: fixed; border-radius: 999px; filter: blur(120px); pointer-events: none; opacity: .08; }
	.ambient-glow-one { width: 520px; height: 520px; right: -160px; top: -190px; background: #e9982c; }
	.ambient-glow-two { width: 360px; height: 360px; left: 22%; bottom: -250px; background: #745027; }

	.session-rail { position: relative; z-index: 5; display: flex; flex-direction: column; min-height: 100dvh; padding: 30px 22px 22px; border-right: 1px solid rgba(240, 190, 104, .1); background: rgba(12, 13, 12, .9); }
	.brand-lockup { display: flex; align-items: center; gap: 13px; padding: 0 6px; }
	.amber-mark { display: grid; width: 38px; height: 44px; place-items: center; border: 1px solid rgba(239, 172, 70, .45); clip-path: polygon(50% 0, 95% 25%, 84% 82%, 50% 100%, 16% 82%, 5% 25%); background: linear-gradient(155deg, rgba(240, 167, 55, .19), rgba(68, 44, 16, .05)); }
	.amber-mark span { width: 8px; height: 15px; border-radius: 50%; background: var(--amber); box-shadow: 0 0 20px rgba(244, 164, 47, .8); transform: rotate(22deg); }
	.brand-eyebrow { margin: 0 0 1px; color: #7e796f; font-size: 9px; font-weight: 600; letter-spacing: .2em; text-transform: uppercase; }
	.brand-lockup h1 { margin: 0; font-family: "Fraunces", serif; font-size: 27px; font-weight: 500; letter-spacing: -.02em; }
	.mobile-close { display: none; margin-left: auto; }

	.new-conversation { display: flex; align-items: center; gap: 11px; width: 100%; margin: 32px 0 30px; padding: 11px 13px; border: 1px solid rgba(234, 166, 62, .22); border-radius: 4px; background: linear-gradient(100deg, rgba(235, 161, 49, .1), rgba(235, 161, 49, .025)); color: #dcd4c5; font-size: 12px; text-align: left; transition: border-color .2s, background .2s, transform .2s; }
	.new-conversation:hover { border-color: rgba(234, 166, 62, .5); background: rgba(235, 161, 49, .13); transform: translateY(-1px); }
	.new-conversation-icon { display: grid; width: 29px; height: 29px; place-items: center; border-radius: 50%; background: var(--amber); color: #241708; }
	.new-conversation-icon :deep(svg) { width: 14px; }
	.new-arrow { width: 13px; margin-left: auto; color: #8d7652; }
	.rail-heading { display: flex; justify-content: space-between; padding: 0 8px 10px; color: #67645d; font-size: 9px; font-weight: 600; letter-spacing: .16em; text-transform: uppercase; }
	.session-list { flex: 1; margin: 0 -5px; overflow-y: auto; scrollbar-width: thin; scrollbar-color: #302b23 transparent; }
	.session-entry { position: relative; display: flex; align-items: center; gap: 10px; width: 100%; min-height: 60px; padding: 10px 10px 10px 15px; border: 0; border-radius: 3px; background: transparent; color: #928d82; text-align: left; transition: background .18s, color .18s; }
	.session-entry:hover { background: rgba(255, 255, 255, .025); color: #ccc4b5; }
	.session-entry-active { background: linear-gradient(90deg, rgba(231, 158, 49, .115), rgba(231, 158, 49, .02)) !important; color: #f0e5d3 !important; }
	.session-thread { position: absolute; left: 1px; width: 1px; height: 0; background: var(--amber); transition: height .2s; }
	.session-entry-active .session-thread { height: 30px; box-shadow: 0 0 9px rgba(234, 160, 49, .5); }
	.session-copy { min-width: 0; flex: 1; }
	.session-copy strong { display: block; overflow: hidden; font-family: "Fraunces", serif; font-size: 14px; font-weight: 400; text-overflow: ellipsis; white-space: nowrap; }
	.session-copy small { display: block; margin-top: 4px; color: #5f5c55; font-size: 9px; }
	.channel-glyph { color: #4e4c47; }
	.channel-glyph :deep(svg) { width: 12px; }
	.rail-loading { display: grid; gap: 14px; padding: 14px 10px; }
	.loading-line { height: 34px; border-radius: 3px; background: linear-gradient(90deg, #151614 25%, #20201c 50%, #151614 75%); background-size: 200% 100%; animation: shimmer 1.6s infinite; }
	.rail-footer { display: grid; gap: 12px; padding-top: 20px; border-top: 1px solid rgba(255, 255, 255, .055); }
	.memory-copy { display: flex; align-items: center; gap: 9px; width: 100%; padding: 0; border: 0; background: transparent; color: #b6a78d; font: inherit; font-size: 11px; text-align: left; cursor: pointer; transition: color .2s; }
	.memory-copy:hover:not(:disabled) { color: var(--amber-bright); }
	.memory-copy:disabled { color: #555149; cursor: default; }
	.memory-copy :deep(svg) { width: 14px; flex: 0 0 auto; }
	.vault-link { display: flex; align-items: center; gap: 9px; padding: 0; border: 0; background: transparent; color: #999387; font: inherit; font-size: 11px; text-decoration: none; cursor: pointer; transition: color .2s; }
	.vault-link:hover { color: var(--amber-bright); }
	.vault-link :deep(svg) { width: 14px; }
	.connection-note { display: flex; align-items: center; gap: 7px; color: #4d554c; font-size: 9px; }
	.connection-note span { width: 5px; height: 5px; border-radius: 50%; background: #667e5d; box-shadow: 0 0 7px #667e5d; }

	.conversation-stage { position: relative; z-index: 2; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; height: 100dvh; min-width: 0; }
	.conversation-header { display: flex; align-items: center; justify-content: space-between; min-height: 86px; padding: 18px clamp(24px, 5vw, 70px); border-bottom: 1px solid rgba(255, 255, 255, .045); background: rgba(11, 12, 11, .68); backdrop-filter: blur(18px); }
	.mobile-menu { display: none; }
	.conversation-identity { display: flex; align-items: center; gap: 20px; min-width: 0; }
	.chapter-index { padding: 4px 6px; border: 1px solid rgba(227, 169, 80, .23); color: #9c7440; font-size: 8px; font-weight: 600; letter-spacing: .17em; }
	.conversation-identity h2 { overflow: hidden; margin: 0; color: #e7dfd1; font-family: "Fraunces", serif; font-size: clamp(18px, 2vw, 22px); font-weight: 400; text-overflow: ellipsis; white-space: nowrap; }
	.conversation-identity p { margin: 3px 0 0; color: #65625c; font-size: 10px; }
	.voice-switch { display: flex; align-items: center; gap: 8px; color: #77736a; font-size: 10px; cursor: pointer; }
	.voice-switch input { position: absolute; opacity: 0; pointer-events: none; }
	.voice-switch-track { position: relative; width: 30px; height: 16px; border: 1px solid #393731; border-radius: 99px; background: #171816; transition: all .2s; }
	.voice-switch-track span { position: absolute; top: 3px; left: 3px; width: 8px; height: 8px; border-radius: 50%; background: #706c62; transition: all .2s; }
	.voice-switch input:checked + .voice-switch-track { border-color: rgba(232, 162, 56, .55); background: rgba(232, 162, 56, .13); }
	.voice-switch input:checked + .voice-switch-track span { left: 17px; background: var(--amber); box-shadow: 0 0 8px rgba(232, 162, 56, .7); }
	.voice-switch :deep(svg) { width: 13px; }

	.message-viewport { overflow-y: auto; scroll-behavior: smooth; }
	.message-ledger { width: min(820px, calc(100% - 48px)); margin: 0 auto; padding: 42px 0 38px; }
	.message-row { display: grid; grid-template-columns: 44px minmax(0, 1fr); gap: 18px; padding: 22px 0; animation: reveal-message .35s ease both; }
	.message-row + .message-row { border-top: 1px solid rgba(255, 255, 255, .04); }
	.speaker-mark { display: flex; justify-content: center; padding-top: 1px; color: #68645b; font-family: "Fraunces", serif; font-size: 11px; font-style: italic; }
	.assistant-gem { display: grid; width: 29px; height: 29px; place-items: center; border: 1px solid rgba(230, 159, 51, .27); transform: rotate(45deg); background: radial-gradient(circle, rgba(233, 160, 50, .18), transparent 70%); color: var(--amber); font-style: normal; }
	.assistant-gem::first-letter { transform: rotate(-45deg); }
	.message-body { min-width: 0; }
	.message-meta { display: flex; align-items: baseline; gap: 9px; margin-bottom: 9px; }
	.message-meta strong { color: #aaa397; font-family: "Fraunces", serif; font-size: 14px; font-weight: 500; }
	.message-assistant .message-meta strong { color: var(--amber-bright); }
	.message-meta span { color: #504e49; font-size: 8px; letter-spacing: .08em; text-transform: uppercase; }
	.message-body > p { margin: 0; color: #c6c0b5; font-family: "Fraunces", serif; font-size: 17px; font-weight: 350; line-height: 1.72; white-space: pre-wrap; overflow-wrap: anywhere; }
	.message-user .message-body > p { color: #969188; }
	.message-actions { display: flex; gap: 5px; margin-top: 13px; opacity: 0; transition: opacity .2s; }
	.message-row:hover .message-actions, .message-actions:focus-within { opacity: 1; }
	.message-actions button { display: flex; align-items: center; gap: 5px; padding: 4px 7px; border: 0; border-radius: 3px; background: transparent; color: #66635d; font-size: 9px; transition: color .2s, background .2s; }
	.message-actions button:hover { background: rgba(255,255,255,.035); color: #bbb3a5; }
	.message-actions :deep(svg) { width: 11px; }
	.pending-message { opacity: .68; }
	.amber-thinking { display: flex; align-items: center; gap: 12px; padding: 16px 0 8px 62px; color: #776d5c; }
	.thinking-gem { color: var(--amber); font-size: 11px; animation: breathe 1.8s infinite; }
	.amber-thinking > div { display: flex; gap: 4px; }
	.amber-thinking i { width: 3px; height: 3px; border-radius: 50%; background: #a77b3e; animation: dot 1.2s infinite; }
	.amber-thinking i:nth-child(2) { animation-delay: .15s; }
	.amber-thinking i:nth-child(3) { animation-delay: .3s; }
	.amber-thinking small { font-family: "Fraunces", serif; font-size: 11px; font-style: italic; }

	.empty-letter { display: flex; align-items: center; flex-direction: column; justify-content: center; width: min(660px, calc(100% - 48px)); min-height: 100%; margin: auto; padding: 60px 0; text-align: center; animation: fade-up .6s ease both; }
	.empty-sigil { display: grid; width: 70px; height: 70px; margin-bottom: 25px; place-items: center; border: 1px solid rgba(231, 161, 53, .26); transform: rotate(45deg); background: radial-gradient(circle, rgba(231, 161, 53, .12), transparent 68%); }
	.empty-sigil span { color: var(--amber); font-size: 18px; transform: rotate(-45deg); text-shadow: 0 0 20px rgba(231,161,53,.7); }
	.empty-kicker { margin: 0 0 9px; color: #9b713b; font-size: 9px; font-weight: 600; letter-spacing: .2em; text-transform: uppercase; }
	.empty-letter h3 { margin: 0; font-family: "Fraunces", serif; font-size: clamp(28px, 4vw, 43px); font-weight: 350; letter-spacing: -.025em; }
	.empty-description { max-width: 490px; margin: 15px auto 27px; color: #706c64; font-family: "Fraunces", serif; font-size: 14px; line-height: 1.65; }
	.prompt-starters { display: flex; flex-wrap: wrap; justify-content: center; gap: 7px; }
	.prompt-starters button { padding: 8px 12px; border: 1px solid rgba(255,255,255,.07); border-radius: 99px; background: rgba(255,255,255,.018); color: #77726a; font-family: "Fraunces", serif; font-size: 11px; transition: all .2s; }
	.prompt-starters button:hover { border-color: rgba(232,162,56,.28); color: #c8b89f; transform: translateY(-1px); }
	.message-loading { display: flex; align-items: center; flex-direction: column; justify-content: center; height: 100%; color: #5f5a50; font-family: "Fraunces", serif; font-size: 12px; }
	.orbital-loader { position: relative; width: 34px; height: 34px; margin-bottom: 10px; animation: orbit 2s linear infinite; }
	.orbital-loader span { position: absolute; width: 5px; height: 5px; border-radius: 50%; background: var(--amber); }
	.orbital-loader span:nth-child(1) { top: 0; left: 14px; }
	.orbital-loader span:nth-child(2) { right: 2px; bottom: 5px; opacity: .5; }
	.orbital-loader span:nth-child(3) { bottom: 5px; left: 2px; opacity: .25; }

	.composer-dock { width: min(860px, calc(100% - 48px)); margin: 0 auto; padding: 10px 0 20px; }
	.composer-frame { padding: 13px 13px 9px 18px; border: 1px solid rgba(223, 177, 105, .17); border-radius: 5px; background: rgba(21, 21, 18, .92); box-shadow: 0 16px 50px rgba(0,0,0,.3), inset 0 1px rgba(255,255,255,.025); transition: border-color .2s, box-shadow .2s; }
	.composer-frame:focus-within { border-color: rgba(232, 162, 56, .42); box-shadow: 0 18px 55px rgba(0,0,0,.38), 0 0 0 1px rgba(232,162,56,.04); }
	.composer-frame textarea { display: block; width: 100%; min-height: 30px; max-height: 150px; resize: none; border: 0; outline: 0; background: transparent; color: #ddd5c7; font-family: "Fraunces", serif; font-size: 16px; line-height: 1.5; }
	.composer-frame textarea::placeholder { color: #5f5b52; }
	.composer-lower { display: flex; align-items: center; justify-content: space-between; margin-top: 7px; }
	.composer-lower > span { color: #4e4b45; font-size: 8px; }
	kbd { padding: 1px 4px; border: 1px solid #37352f; border-radius: 2px; background: #1c1c19; font-family: inherit; }
	.send-button { display: grid; width: 31px; height: 31px; place-items: center; border: 0; border-radius: 50%; background: var(--amber); color: #251708; box-shadow: 0 4px 15px rgba(229,153,42,.2); transition: transform .2s, filter .2s, opacity .2s; }
	.send-button:hover:not(:disabled) { filter: brightness(1.13); transform: translateY(-1px); }
	.send-button:disabled { opacity: .28; }
	.send-button :deep(svg) { width: 15px; }
	.privacy-caption { margin: 8px 0 0; color: #45433e; font-size: 8px; letter-spacing: .04em; text-align: center; }
	.error-note { display: flex; align-items: center; gap: 8px; margin-bottom: 7px; padding: 8px 11px; border: 1px solid rgba(181,82,60,.22); border-radius: 3px; background: rgba(128,48,36,.1); color: #c78c7e; font-size: 10px; }
	.error-note :deep(svg) { width: 13px; }
	.error-note button { display: grid; margin-left: auto; border: 0; background: none; color: inherit; }
	.spin-icon { animation: orbit 1s linear infinite; }
	.sidebar-scrim { display: none; }

	@keyframes shimmer { to { background-position: -200% 0; } }
	@keyframes orbit { to { transform: rotate(360deg); } }
	@keyframes breathe { 50% { opacity: .35; transform: scale(.8); } }
	@keyframes dot { 0%, 60%, 100% { transform: translateY(0); opacity: .35; } 30% { transform: translateY(-3px); opacity: 1; } }
	@keyframes reveal-message { from { opacity: 0; transform: translateY(7px); } }
	@keyframes fade-up { from { opacity: 0; transform: translateY(14px); } }

	@media (max-width: 820px) {
		.chat-shell { grid-template-columns: 1fr; }
		.session-rail { position: fixed; inset: 0 auto 0 0; width: min(330px, 88vw); transform: translateX(-105%); transition: transform .28s ease; box-shadow: 20px 0 80px rgba(0,0,0,.5); }
		.session-rail-open { transform: translateX(0); }
		.mobile-close, .mobile-menu { display: grid; place-items: center; border: 0; background: none; color: #777168; }
		.mobile-close :deep(svg), .mobile-menu :deep(svg) { width: 18px; }
		.sidebar-scrim { position: fixed; z-index: 4; display: block; inset: 0; border: 0; background: rgba(0,0,0,.65); backdrop-filter: blur(3px); }
		.conversation-header { min-height: 74px; padding: 14px 18px; }
		.conversation-identity { gap: 11px; margin-right: auto; margin-left: 12px; }
		.chapter-index { display: none; }
		.voice-switch > span:last-child { display: none; }
		.message-ledger { width: calc(100% - 28px); padding-top: 24px; }
		.message-row { grid-template-columns: 34px 1fr; gap: 10px; }
		.message-body > p { font-size: 16px; }
		.message-actions { opacity: 1; }
		.composer-dock { width: calc(100% - 24px); padding-bottom: 10px; }
		.composer-lower { justify-content: flex-end; }
		.composer-lower > span { display: none; }
		.empty-letter { width: calc(100% - 36px); }
		.prompt-starters { flex-direction: column; }
	}

	@media (prefers-reduced-motion: reduce) {
		*, *::before, *::after { scroll-behavior: auto !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
	}
</style>
