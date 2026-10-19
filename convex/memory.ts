import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireServerOrUser, requireUser } from "./lib/access";

export const saveMemory = mutation({
	args: {
		serverSecret: v.optional(v.string()),
		botUsername: v.string(),
		content: v.string(),
		createdAt: v.number(),
	},
	handler: async (ctx, args) => {
		const { serverSecret, ...memory } = args;
		await requireServerOrUser(ctx, serverSecret);
		return ctx.db.insert("memories", memory);
	},
});

export const getBotMemories = query({
	args: {
		serverSecret: v.optional(v.string()),
		botUsername: v.string(),
	},
	handler: async (ctx, args) => {
		await requireServerOrUser(ctx, args.serverSecret);
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
		await requireUser(ctx);
		await ctx.db.delete(args.memoryId);
	},
});
