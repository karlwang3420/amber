import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
	sessions: defineTable({
		telegramChatId: v.number(),
		title: v.optional(v.string()),
		isActive: v.boolean(),
	})
		.index("by_telegram_chat_id", ["telegramChatId"])
		.index("by_telegram_chat_id_is_active", ["telegramChatId", "isActive"]),

	messages: defineTable({
		sessionId: v.id("sessions"),
		role: v.string(),
		content: v.string(),
		createdAt: v.number(),
	})
		.index("by_session_id", ["sessionId"])
		.index("by_session_id_created_at", ["sessionId", "createdAt"]),
});
