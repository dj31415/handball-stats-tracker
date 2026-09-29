<script lang="ts">
	import { t } from '$lib/i18n/index.svelte';
</script>

<div class="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
	<p class="text-lg">{t('common.loadError')}</p>
	<button class="btn btn-primary" onclick={() => location.reload()}>{t('common.retry')}</button>
</div>
