// Kept in its own file with no imports: middleware runs on the Edge runtime, which cannot
// load node:crypto, so it must not pull in session-token.ts.
export const SESSION_COOKIE = "rf_session";
