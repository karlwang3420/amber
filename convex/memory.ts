import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const saveMemory = mutation({
	args: {
		botUsername: v.string(),
		content: v.string(),
		createdAt: v.number(),
	},
	handler: async (ctx, args) => {
		return ctx.db.insert("memories", args);
	},
});

export const getBotMemories = query({
	args: {
		botUsername: v.string(),
	},
	handler: async (ctx, args) => {
		return ctx.db
			.query("memories")
			.withIndex("by_bot_created_at", (queryBuilder) =>
				queryBuilder.eq("botUsername", args.botUsername),
			)
			.order("asc")
			.collect();
	},
});

export const deleteMemory = mutation({
	args: {
		memoryId: v.id("memories"),
	},
	handler: async (ctx, args) => {
		await ctx.db.delete(args.memoryId);
	},
});
