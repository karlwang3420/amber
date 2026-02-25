/**
 * Bypass H3 v2's built-in CSRF/origin check for the Telegram webhook.
 * Telegram sends server-to-server POST requests without a matching Origin header,
 * which H3 v2 rejects with 403 by default.
 *
 * By removing the Origin header entirely, H3 skips the check.
 */
export default defineEventHandler((event) => {
	if (getRequestURL(event).pathname === "/api/telegram/webhook") {
		// Remove Origin header so H3's CSRF check is skipped
		delete event.node.req.headers["origin"];
		// Also remove referer just in case
		delete event.node.req.headers["referer"];
	}
});
