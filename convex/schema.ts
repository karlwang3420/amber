import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
	sessions: defineTable({
		telegramChatId: v.number(),
		topicId: v.optional(v.number()),
		title: v.optional(v.string()),
		botUsername: v.optional(v.string()),
		isActive: v.boolean(),
		createdAt: v.optional(v.number()),
	})
		.index("by_telegram_chat_id", ["telegramChatId"])
		.index("by_telegram_chat_id_is_active", ["telegramChatId", "isActive"])
		.index("by_telegram_chat_id_topic_id_is_active", [
			"telegramChatId",
			"topicId",
			"isActive",
		]),

	messages: defineTable({
		sessionId: v.id("sessions"),
		role: v.string(),
		content: v.string(),
		createdAt: v.number(),
	})
		.index("by_session_id", ["sessionId"])
		.index("by_session_id_created_at", ["sessionId", "createdAt"]),

	memories: defineTable({
		botUsername: v.string(),
		content: v.string(),
		createdAt: v.number(),
	})
		.index("by_bot", ["botUsername"])
		.index("by_bot_created_at", ["botUsername", "createdAt"]),
});
