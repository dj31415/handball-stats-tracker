<script lang="ts">
	import Modal from './Modal.svelte';
	import { t } from '$lib/i18n/index.svelte';

	let {
		title = t('common.confirm'),
		message,
		confirmLabel = t('common.confirm'),
		cancelLabel = t('action.cancel'),
		onconfirm,
		oncancel
	}: {
		title?: string;
		message: string;
		confirmLabel?: string;
		cancelLabel?: string;
		onconfirm: () => void;
		oncancel: () => void;
	} = $props();
</script>

<Modal {title} onclose={oncancel}>
	{#snippet children()}
		<p>{message}</p>
	{/snippet}
	{#snippet actions()}
		<button class="btn btn-ghost" onclick={oncancel}>{cancelLabel}</button>
		<button class="btn btn-primary" onclick={onconfirm}>{confirmLabel}</button>
	{/snippet}
</Modal>
