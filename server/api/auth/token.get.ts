import { isSignedIn, mintConvexToken } from "../../utils/auth";

// The browser's Convex client calls this whenever it needs a fresh JWT.
// Signed-out visitors get `null`, which the client treats as "no auth".
export default defineEventHandler(async (event) => {
	setResponseHeader(event, "Cache-Control", "no-store");
	if (!(await isSignedIn(event))) {
		return { token: null };
	}
	return { token: mintConvexToken(event) };
});
