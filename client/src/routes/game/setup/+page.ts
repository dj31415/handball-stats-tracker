import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ parent }) => {
	const { role } = await parent();
	if (role !== 'admin') redirect(307, '/history');
};
