import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const createOrGetSession = mutation({
	args: {
		telegramChatId: v.number(),
		topicId: v.optional(v.number()),
		title: v.optional(v.string()),
		botUsername: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const existing =
			args.topicId !== undefined
				? await ctx.db
						.query("sessions")
						.withIndex("by_telegram_chat_id_topic_id_is_active", (q) =>
							q
								.eq("telegramChatId", args.telegramChatId)
								.eq("topicId", args.topicId),
						)
						.filter((q) => q.eq(q.field("isActive"), true))
						.first()
				: await ctx.db
						.query("sessions")
						.withIndex("by_telegram_chat_id_is_active", (q) =>
							q.eq("telegramChatId", args.telegramChatId).eq("isActive", true),
						)
						.filter((q) => q.eq(q.field("topicId"), undefined))
						.first();

		if (existing) {
			return existing._id;
		}

		return ctx.db.insert("sessions", {
			topicId: args.topicId,
			telegramChatId: args.telegramChatId,
			title: args.title,
			botUsername: args.botUsername,
			isActive: true,
			createdAt: Date.now(),
		});
	},
});

export const saveMessage = mutation({
	args: {
		sessionId: v.id("sessions"),
		role: v.union(
			v.literal("user"),
			v.literal("assistant"),
			v.literal("system"),
		),
		content: v.string(),
		createdAt: v.number(),
	},
	handler: async (ctx, args) => {
		return ctx.db.insert("messages", args);
	},
});

export const getSessionHistory = query({
	args: {
		sessionId: v.id("sessions"),
		limit: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		const limit = Math.max(1, Math.min(args.limit ?? 20, 200));

		const docs = await ctx.db
			.query("messages")
			.withIndex("by_session_id_created_at", (queryBuilder) =>
				queryBuilder.eq("sessionId", args.sessionId),
			)
			.order("desc")
			.take(limit);

		return docs.reverse();
	},
});

export const getSessionSystemPrompt = query({
	args: { sessionId: v.id("sessions") },
	handler: async (ctx, args) => {
		const session = await ctx.db.get(args.sessionId);
		return session?.systemPromptSnapshot ?? null;
	},
});

export const setSessionSystemPrompt = mutation({
	args: {
		sessionId: v.id("sessions"),
		systemPromptSnapshot: v.string(),
	},
	handler: async (ctx, args) => {
		await ctx.db.patch(args.sessionId, {
			systemPromptSnapshot: args.systemPromptSnapshot,
		});
	},
});

export const getAllSessions = query({
	args: {
		botUsername: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const sessions = args.botUsername
			? await ctx.db
					.query("sessions")
					.withIndex("by_bot_username", (q) =>
						q.eq("botUsername", args.botUsername),
					)
					.collect()
			: await ctx.db.query("sessions").collect();

		const sessionsWithLastMessage = await Promise.all(
			sessions.map(async (session) => {
				const lastMessage = await ctx.db
					.query("messages")
					.withIndex("by_session_id_created_at", (queryBuilder) =>
						queryBuilder.eq("sessionId", session._id),
					)
					.order("desc")
					.first();

				return {
					...session,
					lastMessageAt: lastMessage?.createdAt ?? 0,
					messageCount: await ctx.db
						.query("messages")
						.withIndex("by_session_id", (queryBuilder) =>
							queryBuilder.eq("sessionId", session._id),
						)
						.collect()
						.then((messages) => messages.length),
				};
			}),
		);

		return sessionsWithLastMessage.sort(
			(a, b) => b.lastMessageAt - a.lastMessageAt,
		);
	},
});

export const deactivateSession = mutation({
	args: {
		telegramChatId: v.number(),
		topicId: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		const existing =
			args.topicId !== undefined
				? await ctx.db
						.query("sessions")
						.withIndex("by_telegram_chat_id_topic_id_is_active", (q) =>
							q
								.eq("telegramChatId", args.telegramChatId)
								.eq("topicId", args.topicId),
						)
						.filter((q) => q.eq(q.field("isActive"), true))
						.first()
				: await ctx.db
						.query("sessions")
						.withIndex("by_telegram_chat_id_is_active", (q) =>
							q.eq("telegramChatId", args.telegramChatId).eq("isActive", true),
						)
						.filter((q) => q.eq(q.field("topicId"), undefined))
						.first();

		if (existing) {
			await ctx.db.patch(existing._id, { isActive: false });
			return true;
		}
		return false;
	},
});

export const createFreshSession = mutation({
	args: {
		telegramChatId: v.number(),
		topicId: v.optional(v.number()),
		title: v.optional(v.string()),
		botUsername: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const existing =
			args.topicId !== undefined
				? await ctx.db
						.query("sessions")
						.withIndex("by_telegram_chat_id_topic_id_is_active", (q) =>
							q
								.eq("telegramChatId", args.telegramChatId)
								.eq("topicId", args.topicId),
						)
						.filter((q) => q.eq(q.field("isActive"), true))
						.first()
				: await ctx.db
						.query("sessions")
						.withIndex("by_telegram_chat_id_is_active", (q) =>
							q.eq("telegramChatId", args.telegramChatId).eq("isActive", true),
						)
						.filter((q) => q.eq(q.field("topicId"), undefined))
						.first();

		if (existing) {
			await ctx.db.patch(existing._id, { isActive: false });
		}

		return ctx.db.insert("sessions", {
			topicId: args.topicId,
			telegramChatId: args.telegramChatId,
			title: args.title,
			botUsername: args.botUsername,
			isActive: true,
			createdAt: Date.now(),
		});
	},
});

export const getMessagesBySession = query({
	args: {
		sessionId: v.optional(v.id("sessions")),
	},
	handler: async (ctx, args) => {
		if (!args.sessionId) {
			return [];
		}

		const sessionId = args.sessionId;
		return ctx.db
			.query("messages")
			.withIndex("by_session_id_created_at", (queryBuilder) =>
				queryBuilder.eq("sessionId", sessionId),
			)
			.order("asc")
			.collect();
	},
});
