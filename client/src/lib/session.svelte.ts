import type { Role } from '@shared/types';

const DEFAULT_CLUB_NAME = 'Handball Stats';

/** Shared session info, filled by the root layout load. */
export const session = $state<{ role: Role | null; clubName: string }>({
	role: null,
	clubName: DEFAULT_CLUB_NAME
});

export function isAdmin(): boolean {
	return session.role === 'admin';
}

/** Document title: "<page> — <club>" (or just the club name without a page title). */
export function pageTitle(title?: string): string {
	return title ? `${title} — ${session.clubName}` : session.clubName;
}

