import { redirect } from '@sveltejs/kit';
import type { LayoutLoad } from './$types';
import { api, ApiError } from '$lib/api';
import { session } from '$lib/session.svelte';
import type { Role } from '@shared/types';

export const prerender = false;
export const ssr = false;

let configPromise: Promise<string> | null = null;

/** The club name is public and static per deployment: fetch it once. */
function loadClubName(): Promise<string> {
	if (!configPromise) {
		configPromise = api
			.config()
			.then((c) => c.club_name)
			.catch((e) => {
				configPromise = null;
				throw e;
			});
	}
	return configPromise;
}

export const load: LayoutLoad = async ({ url, untrack }) => {
	// untrack: only re-run on first load or invalidateAll() (login/logout), not on every navigation.
	const pathname = untrack(() => url.pathname);
	const search = untrack(() => url.search);
	const onLogin = pathname.startsWith('/login');

	try {
		session.clubName = await loadClubName();
	} catch {
		/* keep the default name; the real request below reports connectivity problems */
	}

	if (onLogin) {
		session.role = null;
		return { role: null as Role | null };
	}

	try {
		const { role } = await api.auth.me();
		session.role = role;
		return { role: role as Role | null };
	} catch (e) {
		if (e instanceof ApiError && e.status === 401) {
			session.role = null;
			redirect(307, `/login?next=${encodeURIComponent(pathname + search)}`);
		}
		throw e;
	}
};
