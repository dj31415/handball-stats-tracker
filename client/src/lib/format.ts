import { getLocale } from '$lib/i18n/index.svelte';

export function formatDate(dateStr: string): string {
	const locale = getLocale();
	const intlLocale = locale === 'de' ? 'de-DE' : 'en-GB';
	try {
		return new Intl.DateTimeFormat(intlLocale, {
			day: '2-digit', month: '2-digit', year: 'numeric'
		}).format(new Date(dateStr));
	} catch {
		return dateStr;
	}
}

export function formatDateShort(dateStr: string): string {
	const locale = getLocale();
	const intlLocale = locale === 'de' ? 'de-DE' : 'en-GB';
	try {
		return new Intl.DateTimeFormat(intlLocale, {
			day: '2-digit', month: '2-digit'
		}).format(new Date(dateStr));
	} catch {
		return dateStr;
	}
}
