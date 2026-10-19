import { isSignedIn } from "../../utils/auth";

export default defineEventHandler(async (event) => {
	setResponseHeader(event, "Cache-Control", "no-store");
	return { signedIn: await isSignedIn(event) };
});
