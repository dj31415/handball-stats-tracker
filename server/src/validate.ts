import type { Context } from 'hono';

/** zValidator hook: respond 400 {error:'invalid', details} on validation failure. */
export function invalid(result: { success: boolean; error?: { issues: unknown[] } }, c: Context) {
	if (!result.success) {
		return c.json({ error: 'invalid', details: result.error?.issues }, 400);
	}
}
