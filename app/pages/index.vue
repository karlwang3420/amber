<script setup lang="ts">
	import { makeFunctionReference } from "convex/server";
	import { useConvexQuery } from "convex-vue";

	type Session = {
		_id: string;
		_creationTime: number;
		telegramChatId: number;
		title?: string;
		isActive: boolean;
		lastMessageAt: number;
		messageCount: number;
	};

	type Message = {
		_id: string;
		_creationTime: number;
		sessionId: string;
		role: "user" | "assistant" | "system";
		content: string;
		createdAt: number;
	};

	const getAllSessionsRef = makeFunctionReference<
		"query",
		Record<string, never>,
		Session[]
	>("chat:getAllSessions");
	const getMessagesBySessionRef = makeFunctionReference<
		"query",
		{ sessionId?: string },
		Message[]
	>("chat:getMessagesBySession");

	const { data: sessionsData, isPending: sessionsPending } = useConvexQuery(
		getAllSessionsRef,
		{},
	);

	const selectedSessionId = ref<string | null>(null);

	const sessions = computed(() => sessionsData.value ?? []);

	watch(
		sessions,
		(nextSessions) => {
			const firstSession = nextSessions[0];

			if (!selectedSessionId.value && firstSession) {
				selectedSessionId.value = firstSession._id;
			}

			if (
				selectedSessionId.value &&
				!nextSessions.find((session) => session._id === selectedSessionId.value)
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

	function formatTimestamp(timestamp: number) {
		if (!timestamp) {
			return "-";
		}

		return new Date(timestamp).toLocaleString();
	}

	function selectSession(sessionId: string) {
		selectedSessionId.value = sessionId;
	}

	function exportSelectedSessionAsJson() {
		if (!selectedSession.value) {
			return;
		}

		const payload = {
			session: selectedSession.value,
			messages: messages.value,
		};

		const blob = new Blob([JSON.stringify(payload, null, 2)], {
			type: "application/json",
		});

		const sessionLabel =
			selectedSession.value.title?.trim() ||
			`chat-${selectedSession.value.telegramChatId}`;
		const fileName = `${sessionLabel.replace(/[^a-z0-9-_]/gi, "_")}.json`;
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = fileName;
		anchor.click();
		URL.revokeObjectURL(url);
	}
</script>

<template>
	<UContainer class="py-8">
		<div class="space-y-4">
			<div>
				<h1 class="text-2xl font-semibold">Soul Amber Vault</h1>
				<p>Persistent Telegram memory stored in Convex.</p>
			</div>

			<div class="grid gap-4 md:grid-cols-[280px_1fr]">
				<UCard>
					<template #header>
						<div class="flex items-center justify-between">
							<h2 class="font-medium">Sessions</h2>
							<UBadge variant="subtle">
								{{ sessions.length }}
							</UBadge>
						</div>
					</template>

					<div class="space-y-2 max-h-[70vh] overflow-auto">
						<p v-if="sessionsPending">Loading sessions...</p>
						<template v-else>
							<UButton
								v-for="session in sessions"
								:key="session._id"
								block
								:variant="selectedSessionId === session._id ? 'solid' : 'ghost'"
								@click="selectSession(session._id)">
								<div class="w-full text-left">
									<div class="font-medium truncate">
										{{ session.title || `Chat ${session.telegramChatId}` }}
									</div>
									<div class="text-xs">{{ session.messageCount }} messages</div>
								</div>
							</UButton>
							<p v-if="sessions.length === 0">No sessions yet.</p>
						</template>
					</div>
				</UCard>

				<UCard>
					<template #header>
						<div class="flex items-center justify-between gap-3">
							<div>
								<h2 class="font-medium">
									{{
										selectedSession?.title ||
										(selectedSession
											? `Chat ${selectedSession.telegramChatId}`
											: "Messages")
									}}
								</h2>
								<p v-if="selectedSession" class="text-sm">
									Last activity:
									{{ formatTimestamp(selectedSession.lastMessageAt) }}
								</p>
							</div>
							<UButton
								label="Export JSON"
								:disabled="!selectedSession"
								@click="exportSelectedSessionAsJson" />
						</div>
					</template>

					<div class="space-y-3 max-h-[70vh] overflow-auto">
						<p v-if="messagesPending">Loading messages...</p>
						<template v-else>
							<div
								v-for="message in messages"
								:key="message._id"
								class="rounded-md border p-3">
								<div class="mb-2 flex items-center justify-between gap-3">
									<UBadge variant="soft">
										{{ message.role }}
									</UBadge>
									<span class="text-xs">{{
										formatTimestamp(message.createdAt)
									}}</span>
								</div>
								<p class="whitespace-pre-wrap break-words">
									{{ message.content }}
								</p>
							</div>
							<p v-if="messages.length === 0">
								Select a session to view messages.
							</p>
						</template>
					</div>
				</UCard>
			</div>
		</div>
	</UContainer>
</template>
