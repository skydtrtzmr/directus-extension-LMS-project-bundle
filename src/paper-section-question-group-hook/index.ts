import { defineHook } from '@directus/extensions-sdk';

// 现存bug：没有过滤掉已存在的题目，导致重复添加
export default defineHook(({ filter }, { services, logger }) => {
	const { ItemsService } = services;

	// 共享的处理函数，用于处理创建和更新时的逻辑
	const handlePaperSectionChange = async (payload: any, meta: any, context: any, isCreate = false) => {
		try {
			// 输出原始输入参数完整结构
			console.log('====== HOOK TRIGGERED ======');
			console.log(`EVENT TYPE: ${isCreate ? 'CREATE' : 'UPDATE'}`);
			console.log('FULL PAYLOAD:', JSON.stringify(payload, null, 2));
			console.log('FULL META:', JSON.stringify(meta, null, 2));
			console.log('META KEYS:', meta.keys);
			logger.info(`hook triggered for paper_sections.items.${isCreate ? 'create' : 'update'}`);

			// 获取paper_section ID (创建操作可能没有ID)
			const paperId = isCreate ? null : meta.keys?.[0] || meta.key;
			
			if (!isCreate && !paperId) {
				logger.warn('无法获取有效的paper_sections ID');
				console.log('ERROR: Missing paperId - meta.keys or meta.key not found');
				return payload;
			}
			
			if (paperId) {
				console.log(`PAPER SECTION ID: ${paperId}`);
				logger.info(`处理paper_section ID: ${paperId}`);
			}

			const { accountability, schema } = context;
			const serviceOptions = { schema, accountability };
			
			// 创建必要的服务
			const paperSectionsService = new ItemsService('paper_sections', serviceOptions);
			const questionsService = new ItemsService('questions', serviceOptions);
			
			// 调试payload.question_groups字段结构
			if (payload.question_groups) {
				console.log('QUESTION_GROUPS PAYLOAD TYPE:', typeof payload.question_groups);
				console.log('QUESTION_GROUPS PAYLOAD:', JSON.stringify(payload.question_groups, null, 2));
				logger.info(`question_groups字段类型: ${typeof payload.question_groups}`);
			} else {
				console.log('NO QUESTION_GROUPS IN PAYLOAD');
				logger.info('未检测到question_groups字段');
				return payload; // 如果没有question_groups字段，直接返回
			}

			// 确定当前数据
			let currentGroups: string[] = [];
			
			// 如果是更新操作，读取当前paper_section的数据
			if (!isCreate && paperId) {
				console.log(`Reading current paper_section (${paperId})...`);
				const current = await paperSectionsService.readOne(paperId, {
					fields: ['question_groups']
				});
				console.log('CURRENT PAPER SECTION:', JSON.stringify(current, null, 2));
				logger.info(`获取到当前paper_section数据, question_groups长度: ${current.question_groups?.length || 0}`);
				
				// 确保当前数据字段是数组格式
				currentGroups = Array.isArray(current.question_groups) ? current.question_groups : [];
				
				console.log('Current groups:', currentGroups);
			}
			
			// ========== 处理 question_groups 变更 ==========
			if (payload.question_groups) {
				// 1. 处理直接替换整个数组的情况（直接比较差异）
				if (Array.isArray(payload.question_groups)) {
					console.log('Detecting changes from array replacement');
					
					// 对于创建操作，所有组都是新增的
					// 对于更新操作，只处理新增的组
					const addedGroups = isCreate 
						? payload.question_groups 
						: payload.question_groups.filter(
							(id: string) => !currentGroups.includes(id)
						);
					
					console.log('Added groups:', addedGroups);
					
					// 处理新增组对应的问题
					if (addedGroups.length > 0) {
						let newQuestions: any[] = [];
						
						for (const groupId of addedGroups) {
							console.log(`Fetching questions for group: ${groupId}`);
							const questions = await questionsService.readByQuery({
								filter: { question_group: { _eq: groupId } },
								fields: ['id']
							});
							
							console.log(`Found ${questions.length} questions for group ${groupId}:`, questions);
							
							if (questions.length > 0) {
								newQuestions = [...newQuestions, ...questions];
							}
						}
						
						console.log(`Total new questions to add: ${newQuestions.length}`);
						
						if (newQuestions.length > 0) {
							// 添加问题
							if (!payload.questions) {
								payload.questions = {
									create: newQuestions.map(q => ({ questions_id: q.id }))
								};
							} else if (payload.questions.create) {
								payload.questions.create = [
									...payload.questions.create, 
									...newQuestions.map(q => ({ questions_id: q.id }))
								];
							} else {
								payload.questions = {
									...payload.questions,
									create: newQuestions.map(q => ({ questions_id: q.id }))
								};
							}
							
							console.log('Updated questions in payload:', JSON.stringify(payload.questions, null, 2));
						}
					}
				}
				// 2. 处理对象格式 {create:[], update:[], delete:[]}
				else if (typeof payload.question_groups === 'object') {
					console.log('Processing question_groups as object format');
					
					// 处理新增组
					if (Array.isArray(payload.question_groups.create) && 
						payload.question_groups.create.length > 0) {
						
						console.log('Processing new question_groups.create:', JSON.stringify(payload.question_groups.create, null, 2));
						
						// 解析新增组ID
						const newGroupIds = payload.question_groups.create
							.map((item: any) => {
								// 调试每个项目的结构
								console.log('Group create item:', JSON.stringify(item, null, 2));
								
								if (item.question_groups_id?.id) return item.question_groups_id.id;
								if (item.question_groups_id) return item.question_groups_id;
								return null;
							})
							.filter(Boolean);
						
						console.log('Extracted new group IDs:', newGroupIds);
						
						// 如果有新增组，获取这些组下的问题
						if (newGroupIds.length > 0) {
							let newQuestions: any[] = [];
							
							for (const groupId of newGroupIds) {
								console.log(`Fetching questions for new group: ${groupId}`);
								const questions = await questionsService.readByQuery({
									filter: { question_group: { _eq: groupId } },
									fields: ['id']
								});
								
								console.log(`Found ${questions.length} questions for new group ${groupId}:`, questions);
								
								if (questions.length > 0) {
									newQuestions = [...newQuestions, ...questions];
								}
							}
							
							console.log(`Total new questions to add: ${newQuestions.length}`);
							
							if (newQuestions.length > 0) {
								// 添加问题
								if (!payload.questions) {
									payload.questions = {
										create: newQuestions.map(q => ({ questions_id: q.id }))
									};
								} else if (payload.questions.create) {
									payload.questions.create = [
										...payload.questions.create, 
										...newQuestions.map(q => ({ questions_id: q.id }))
									];
								} else {
									payload.questions = {
										...payload.questions,
										create: newQuestions.map(q => ({ questions_id: q.id }))
									};
								}
								
								console.log('Updated questions create in payload:', JSON.stringify(payload.questions, null, 2));
							}
						}
					}
				}
			}
			
			// 检查最终payload
			console.log('====== FINAL PAYLOAD ======');
			console.log(JSON.stringify(payload, null, 2));
			logger.info('完成payload构建，返回更新后的payload');
			
			return payload;
		} catch (error) {
			// 详细记录错误信息
			console.error('====== ERROR IN HOOK ======');
			console.error(error);
			console.error(error instanceof Error ? error.stack : 'No stack trace');
			const msg = error instanceof Error ? error.message : '未知错误';
			logger.error(`同步paper_sections关联字段时出错: ${msg}`);
			return payload;
		}
	};

	// 监听更新事件
	filter('paper_sections.items.update', async (payload: any, meta: any, context: any) => {
		return handlePaperSectionChange(payload, meta, context, false);
	});

	// 监听创建事件
	filter('paper_sections.items.create', async (payload: any, meta: any, context: any) => {
		return handlePaperSectionChange(payload, meta, context, true);
	});
});
