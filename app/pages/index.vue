<script setup lang="ts">
	import { makeFunctionReference } from "convex/server";
	import { useConvexQuery, useConvexMutation } from "convex-vue";

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
		_creationTime: number;
		sessionId: string;
		role: "user" | "assistant" | "system";
		content: string;
		createdAt: number;
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

	const { data: sessionsData, isPending: sessionsPending } = useConvexQuery(
		getAllSessionsRef,
		{ botUsername: botUsername || undefined },
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

	// Memory form

	const saveMemoryRef = makeFunctionReference<
		"mutation",
		{ botUsername: string; content: string; createdAt: number },
		null
	>("memory:saveMemory");

	const { mutate: saveMemory, isPending: saveMemoryPending } =
		useConvexMutation(saveMemoryRef);

	const memoryForm = reactive({
		date: new Date().toISOString().slice(0, 10),
		content: "",
	});
	const memorySaved = ref(false);

	async function submitMemory() {
		if (!memoryForm.content.trim() || !memoryForm.date) return;
		const createdAt = new Date(memoryForm.date + "T12:00:00Z").getTime();
		await saveMemory({
			botUsername,
			content: memoryForm.content.trim(),
			createdAt,
		});
		memoryForm.content = "";
		memoryForm.date = new Date().toISOString().slice(0, 10);
		memorySaved.value = true;
		setTimeout(() => (memorySaved.value = false), 3000);
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
			(selectedSession.value.telegramChatId
				? `chat-${selectedSession.value.telegramChatId}`
				: `web-${selectedSession.value._id}`);
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
	<div class="min-h-screen bg-gray-950 text-gray-100">
		<!-- Header -->
		<header
			class="sticky top-0 z-10 border-b border-amber-900/30 bg-gray-950/80 backdrop-blur-md">
			<UContainer class="flex items-center justify-between py-4">
				<div class="flex items-center gap-3">
					<div
						class="flex size-9 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400">
						<UIcon name="i-lucide-gem" class="size-5" />
					</div>
					<div>
						<h1 class="text-lg font-semibold tracking-tight text-amber-50">
							Soul Amber Vault
						</h1>
						<p class="text-xs text-gray-500">
							Shared conversation memory &middot; Convex
						</p>
					</div>
				</div>
				<div class="flex items-center gap-2">
					<UButton
						to="/chat"
						label="Open chat"
						icon="i-lucide-message-circle"
						color="primary"
						variant="soft"
						size="sm" />
					<UBadge v-if="botUsername" color="neutral" variant="outline" size="sm">
						@{{ botUsername }}
					</UBadge>
					<UButton
						label="Sign out"
						icon="i-lucide-log-out"
						color="neutral"
						variant="ghost"
						size="sm"
						@click="signOut" />
				</div>
			</UContainer>
		</header>

		<UContainer class="py-6 space-y-6">
			<!-- Memory Entry Card -->
			<UCard
				class="border-amber-900/20"
				:ui="{ header: 'bg-amber-500/5 border-b border-amber-900/20' }">
				<template #header>
					<div class="flex items-center gap-2">
						<UIcon name="i-lucide-plus-circle" class="size-4 text-amber-400" />
						<h2 class="text-sm font-medium text-amber-200">Add Memory Entry</h2>
					</div>
				</template>

				<div class="space-y-4">
					<div class="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
						<UFormField label="Bot" class="text-gray-400">
							<UInput :model-value="botUsername || '—'" disabled size="sm" />
						</UFormField>

						<UFormField label="Date" class="text-gray-400">
							<UInput v-model="memoryForm.date" type="date" size="sm" />
						</UFormField>

						<div class="flex items-center gap-2">
							<UButton
								label="Save"
								icon="i-lucide-save"
								color="primary"
								size="sm"
								:loading="saveMemoryPending"
								:disabled="!memoryForm.content.trim() || !memoryForm.date"
								@click="submitMemory" />
						</div>
					</div>

					<UFormField label="Memory" class="text-gray-400">
						<UTextarea
							v-model="memoryForm.content"
							placeholder="Enter memory content..."
							:rows="3"
							size="sm"
							class="w-full" />
					</UFormField>
				</div>

				<Transition
					enter-active-class="transition duration-200"
					enter-from-class="opacity-0 translate-y-1"
					leave-active-class="transition duration-150"
					leave-to-class="opacity-0">
					<UBadge v-if="memorySaved" color="success" variant="soft" size="xs">
						Saved
					</UBadge>
				</Transition>
			</UCard>

			<!-- Sessions + Messages Grid -->
			<div class="grid gap-4 lg:grid-cols-[300px_1fr]">
				<!-- Sessions Sidebar -->
				<UCard
					class="border-gray-800"
					:ui="{ header: 'border-b border-gray-800' }">
					<template #header>
						<div class="flex items-center justify-between">
							<div class="flex items-center gap-2">
								<UIcon
									name="i-lucide-message-square"
									class="size-4 text-gray-500" />
								<h2 class="text-sm font-medium">Sessions</h2>
							</div>
							<UBadge color="neutral" variant="subtle" size="xs">
								{{ sessions.length }}
							</UBadge>
						</div>
					</template>

					<div class="space-y-1 max-h-[65vh] overflow-auto -mx-2">
						<div
							v-if="sessionsPending"
							class="flex items-center justify-center py-8 text-gray-500">
							<UIcon
								name="i-lucide-loader-2"
								class="size-5 animate-spin mr-2" />
							<span class="text-sm">Loading...</span>
						</div>
						<template v-else>
							<button
								v-for="session in sessions"
								:key="session._id"
								class="w-full rounded-lg px-3 py-2.5 text-left transition-colors"
								:class="
									selectedSessionId === session._id
										? 'bg-amber-500/10 text-amber-200'
										: 'text-gray-400 hover:bg-gray-800/60 hover:text-gray-200'
								"
								@click="selectSession(session._id)">
								<div class="font-medium text-sm truncate">
									{{
										session.title ||
										(session.telegramChatId
											? `Chat ${session.telegramChatId}`
											: "Web conversation")
									}}
								</div>
								<div class="text-xs mt-0.5 opacity-60">
									{{ session.messageCount }} messages
								</div>
							</button>
							<p
								v-if="sessions.length === 0"
								class="py-8 text-center text-sm text-gray-600">
								No sessions yet.
							</p>
						</template>
					</div>
				</UCard>

				<!-- Messages Panel -->
				<UCard
					class="border-gray-800"
					:ui="{ header: 'border-b border-gray-800' }">
					<template #header>
						<div class="flex items-center justify-between gap-3">
							<div class="min-w-0">
								<h2 class="text-sm font-medium truncate">
									{{
										selectedSession?.title ||
										(selectedSession
											? selectedSession.telegramChatId
												? `Chat ${selectedSession.telegramChatId}`
												: "Web conversation"
											: "Select a session")
									}}
								</h2>
								<p v-if="selectedSession" class="text-xs text-gray-500 mt-0.5">
									Last activity:
									{{ formatTimestamp(selectedSession.lastMessageAt) }}
								</p>
							</div>
							<UButton
								label="Export"
								icon="i-lucide-download"
								variant="outline"
								color="neutral"
								size="xs"
								:disabled="!selectedSession"
								@click="exportSelectedSessionAsJson" />
						</div>
					</template>

					<div class="space-y-3 max-h-[65vh] overflow-auto">
						<div
							v-if="messagesPending"
							class="flex items-center justify-center py-12 text-gray-500">
							<UIcon
								name="i-lucide-loader-2"
								class="size-5 animate-spin mr-2" />
							<span class="text-sm">Loading messages...</span>
						</div>
						<template v-else>
							<div
								v-for="message in messages"
								:key="message._id"
								class="rounded-lg border p-3"
								:class="
									message.role === 'assistant'
										? 'border-amber-900/30 bg-amber-500/5'
										: message.role === 'system'
											? 'border-purple-900/30 bg-purple-500/5'
											: 'border-gray-800 bg-gray-900/50'
								">
								<div
									class="mb-2 flex items-center justify-between gap-3 text-xs">
									<UBadge
										:color="
											message.role === 'assistant'
												? 'warning'
												: message.role === 'system'
													? 'info'
													: 'neutral'
										"
										variant="subtle"
										size="xs">
										{{ message.role }}
									</UBadge>
									<span class="text-gray-600">
										{{ formatTimestamp(message.createdAt) }}
									</span>
								</div>
								<p
									class="whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-300">
									{{ message.content }}
								</p>
							</div>
							<div
								v-if="messages.length === 0 && !selectedSession"
								class="py-12 text-center">
								<UIcon
									name="i-lucide-message-square-dashed"
									class="mx-auto size-10 text-gray-700 mb-3" />
								<p class="text-sm text-gray-600">
									Select a session to view messages.
								</p>
							</div>
							<div v-else-if="messages.length === 0" class="py-12 text-center">
								<p class="text-sm text-gray-600">
									No messages in this session.
								</p>
							</div>
						</template>
					</div>
				</UCard>
			</div>
		</UContainer>
	</div>
</template>
