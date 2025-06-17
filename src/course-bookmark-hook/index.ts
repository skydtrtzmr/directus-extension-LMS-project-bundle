import { defineHook } from '@directus/extensions-sdk';
import type { RegisterFunctions } from '@directus/extensions';
import type { HookExtensionContext } from '@directus/extensions';
import type { EventContext } from '@directus/types';
import { log } from 'console';
// 根据课程，创建directus对应的书签。

export default defineHook(({ filter, action }: RegisterFunctions, { services, getSchema }: HookExtensionContext) => {

	action('courses.items.create', handler);

	async function handler(meta: Record<string, any>, context: EventContext) {
		log('Creating Course Item!');
		log("meta:");
		log(meta);
		log("context:");
		log(context);
		const { PresetsService } = services;

		const presetService = new PresetsService({
			...context,
			schema: await getSchema(),
		});

		const preset = await presetService.createOne({
			bookmark: '这里是课程名称',
			collection: 'papers',
			layout: 'tabular',
			layout_query: {"tabular":{"page":1}},
			icon: 'bookmark'
		});

		log('preset', preset);
		// 直接打印的话返回的是id。
	}
});
