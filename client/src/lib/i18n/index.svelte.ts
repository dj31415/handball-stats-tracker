import { de, type TranslationKey } from './de';
import { en } from './en';

export type Locale = 'de' | 'en';
export type { TranslationKey };

const translations: Record<Locale, Record<TranslationKey, string>> = { de, en };

const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('locale') : null;
let locale = $state<Locale>((stored === 'de' || stored === 'en') ? stored : 'de');

export function getLocale(): Locale {
	return locale;
}

export function setLocale(l: Locale) {
	locale = l;
	localStorage.setItem('locale', l);
	document.documentElement.lang = l;
}

export function t(key: TranslationKey, params?: Record<string, string | number>): string {
	let str = translations[locale][key] ?? key;
	if (params) {
		for (const [k, v] of Object.entries(params)) {
			str = str.replaceAll(`{{${k}}}`, String(v));
		}
	}
	return str;
}
