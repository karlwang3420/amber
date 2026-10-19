import { ConvexHttpClient } from "convex/browser";
import type {
	FunctionArgs,
	FunctionReference,
	FunctionReturnType,
} from "convex/server";

/**
 * Convex client for Nuxt server routes. Every call carries the shared
 * AMBER_SERVER_SECRET, which Convex functions check (convex/lib/access.ts).
 * Function references describe their arguments without `serverSecret`.
 */
export function createServerConvex(convexUrl: string, serverSecret: string) {
	const client = new ConvexHttpClient(convexUrl);

	// Convex argument-validation errors echo the full argument object, so
	// scrub the secret before the error reaches logs or HTTP responses.
	const redact = (error: unknown) => {
		if (error instanceof Error) {
			error.message = error.message.replaceAll(serverSecret, "[redacted]");
			error.stack = error.stack?.replaceAll(serverSecret, "[redacted]");
		}
		throw error;
	};

	return {
		query<Query extends FunctionReference<"query">>(
			query: Query,
			args: FunctionArgs<Query>,
		): Promise<FunctionReturnType<Query>> {
			return client.query(query, { ...args, serverSecret }).catch(redact);
		},
		mutation<Mutation extends FunctionReference<"mutation">>(
			mutation: Mutation,
			args: FunctionArgs<Mutation>,
		): Promise<FunctionReturnType<Mutation>> {
			return client
				.mutation(mutation, { ...args, serverSecret })
				.catch(redact);
		},
	};
}

export type ServerConvex = ReturnType<typeof createServerConvex>;
