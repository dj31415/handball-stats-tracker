import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

// Live tracking is for admins only; viewers get the read-only view.
export const load: PageLoad = async ({ parent, params }) => {
	const { role } = await parent();
	if (role !== 'admin') redirect(307, `/history/${params.id}`);
};
