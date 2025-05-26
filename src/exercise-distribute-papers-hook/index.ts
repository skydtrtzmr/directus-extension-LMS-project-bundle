import { defineHook } from '@directus/extensions-sdk';

export default defineHook(({ filter }, { services, database, logger }) => {
	const { ItemsService } = services;

	// 使用filter钩子而不是action钩子，因为filter在操作发生前触发
	filter('exercises.items.update', async (payload: any, meta: any, context: any) => {
		// 只在状态变更为published时处理
		if (!payload || payload.status !== 'published') return payload;
		
		try {
			// 获取更新前的数据检查状态是否为draft
			const exerciseId = meta.keys?.[0] || meta.key;
			
			if (!exerciseId) {
				logger.warn('无法获取有效的考试ID');
				return payload;
			}
			
			const accountability = context.accountability;
			const schema = context.schema;
			const serviceOptions = { schema, accountability };
			
			const exercisesService = new ItemsService('exercises', serviceOptions);
			
			// 在filter钩子中，可以直接查询当前数据库中的状态，因为更新还未发生
			const exerciseBeforeUpdate = await exercisesService.readOne(exerciseId, {
				fields: ['status']
			}).catch(() => null);
			
			// 只有当之前状态为draft时才执行发卷操作
			if (!exerciseBeforeUpdate || exerciseBeforeUpdate.status !== 'draft') {
				return payload;
			}
			
			logger.info(`开始为考试ID: ${exerciseId} 批量发卷流程`);
			
			// 创建所需服务实例
			const paperSectionsService = new ItemsService('paper_sections', serviceOptions);
			const paperSectionsQuestionsService = new ItemsService('paper_sections_questions', serviceOptions);
			const exercisesStudentsService = new ItemsService('exercises_students', serviceOptions);
			const practiceSessionsService = new ItemsService('practice_sessions', serviceOptions);
			const questionResultsService = new ItemsService('question_results', serviceOptions);
			
			// 1. 获取考试和试卷信息
			const exercise = exerciseBeforeUpdate; // 已经有了基本信息，如果需要更多信息再查询一次
			if (!exercise || !exercise.paper) {
				// 如果缺少必要信息，再查询一次
				const fullExercise = await exercisesService.readOne(exerciseId);
				if (!fullExercise || !fullExercise.paper) {
					throw new Error('找不到有效的考试或试卷信息');
				}
				
				// 使用完整信息替换原来的引用
				Object.assign(exercise, fullExercise);
			}
			
			// 2. 获取试卷章节
			const paperSections = await paperSectionsService.readByQuery({
				filter: { paper_id: { _eq: exercise.paper } },
				fields: ['id', 'points_per_question']
			});
			
			if (!paperSections.length) {
				throw new Error('试卷没有章节信息');
			}
			
			// 3. 获取章节ID列表
			const sectionIds = paperSections.map((section: { id: string }) => section.id);
			
			// 4. 获取所有题目信息
			const questions = await paperSectionsQuestionsService.readByQuery({
				filter: { paper_sections_id: { _in: sectionIds } },
				fields: [
					'id', 
					'paper_sections_id', 
					'questions_id.type', 
					'questions_id.correct_ans_select_radio', 
					'questions_id.correct_ans_select_multiple_checkbox'
				]
			});
			
			if (!questions.length) {
				throw new Error('试卷没有题目信息');
			}
			
			// 5. 获取所有考生
			const students = await exercisesStudentsService.readByQuery({
				filter: { exercises_id: { _eq: exerciseId } },
				limit: -1 // 一定注意要把limit设置为-1，否则只会返回100条数据
			});
			
			if (!students.length) {
				throw new Error('没有找到考生信息');
			}
			
			logger.info(`准备为${students.length}名考生创建练习记录，每人${questions.length}道题目`);
			
			// 6. 使用事务批量处理数据以提高性能和保证数据一致性
			await database.transaction(async trx => {
				// 构建章节与分值的映射表
				const sectionPointsMap = new Map(
					paperSections.map((sec: { id: string; points_per_question: number }) => [sec.id, sec.points_per_question])
				);
				// 为每个考生创建练习会话和答题记录
				for (const student of students) {
					// 创建练习会话
					const practiceSessionId = await practiceSessionsService.createOne({
						exercises_students_id: student.id
					}, { emitEvents: false, trx });
					
					// 批量创建答题记录
					const questionResultsBatch = questions.map((question: any) => ({
						practice_session_id: practiceSessionId,
						question_in_paper_id: question.id,
						question_type: question.questions_id?.type,
						correct_ans_select_radio: question.questions_id?.correct_ans_select_radio,
						correct_ans_select_multiple_checkbox: question.questions_id?.correct_ans_select_multiple_checkbox,
						// 从映射表中取出对应章节的分值
						point_value: sectionPointsMap.get(question.paper_sections_id) ?? 0
					}));
					
					await questionResultsService.createMany(questionResultsBatch, { 
						emitEvents: false, 
						trx 
					});
				}
			});
			
			logger.info(`批量发卷成功完成：${exerciseId}`);
			
			// 必须返回payload，这样更新操作才能继续
			return payload;
		} catch (error: unknown) {
			const errorMessage = error instanceof Error ? error.message : '未知错误';
			logger.error(`批量发卷过程中出错: ${errorMessage}`);
			// 出错时也要返回payload，让更新操作继续
			return payload;
		}
	});
});