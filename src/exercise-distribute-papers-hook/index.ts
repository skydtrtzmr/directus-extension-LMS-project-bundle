import { defineHook } from '@directus/extensions-sdk';
import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";

// 初始化 Redis 连接和队列（模块级别）
const connection = new IORedis(process.env.REDIS!, {
    maxRetriesPerRequest: null,
});

const exerciseDistributeQueue = new Queue("exerciseDistributeQueue", { connection });
const practiceSessionCacheQueue = new Queue("practiceSessionCacheQueue", { connection });

export default defineHook(({ filter, action }, { services, database, logger }) => {
	const { ItemsService } = services;

	// 初始化 Worker（只初始化一次）
	let workerInitialized = false;
	if (!workerInitialized) {
		const worker = new Worker(
			"exerciseDistributeQueue",
			async (job) => {
				const { exerciseId, studentId, questions, sectionPointsMap } = job.data;
				
				try {
					logger.info(`Worker (job ${job.id}): 开始为学生 ${studentId} 分发练习 ${exerciseId} 的试卷`);

					// 创建服务实例 (Worker中需要重新创建)
					const practiceSessionsService = new ItemsService('practice_sessions', {
						schema: job.data.schema,
						accountability: job.data.accountability,
					});
					const questionResultsService = new ItemsService("question_results", {
						schema: job.data.schema,
						accountability: job.data.accountability,
					});

					// 1. 为该学生创建练习会话
					const practiceSessionId = await practiceSessionsService.createOne({
						exercises_students_id: studentId
					}, { emitEvents: true });

					// 2. 准备该学生的所有答题记录
					const questionResultsBatch = questions.map((question: any) => ({
						practice_session_id: practiceSessionId,
						question_in_paper_id: question.id,
						question_type: question.questions_id?.type,
						correct_ans_select_radio: question.questions_id?.correct_ans_select_radio,
						correct_ans_select_multiple_checkbox: question.questions_id?.correct_ans_select_multiple_checkbox,
						point_value: sectionPointsMap[question.paper_sections_id] ?? 0,
					}));

					// 3. 批量插入该学生的所有答题记录
					await questionResultsService.createMany(questionResultsBatch, {
						emitEvents: true,
					});

					// 派发一个任务到缓存队列，以更新这个练习会话的缓存
					try {
						await practiceSessionCacheQueue.add('cache-practice-session', { 
							practiceSessionId: practiceSessionId,
							schema: job.data.schema, // 传递 schema 给缓存 Worker
						 });
						logger.info(`Worker (job ${job.id}): Successfully queued cache update for practice session ${practiceSessionId}`);
					} catch (queueError) {
						logger.error(`Worker (job ${job.id}): Failed to queue cache update for practice session ${practiceSessionId}:`, queueError);
						// 此处的失败不应中断主流程，因此只记录错误。缓存最终会通过定时任务刷新。
					}

					logger.info(`Worker (job ${job.id}): 成功为学生 ${studentId} 创建练习会话 ${practiceSessionId} 并分发 ${questionResultsBatch.length} 道题目`);

				} catch (error) {
					logger.error(`Worker (job ${job.id}): 为学生 ${studentId} 分发练习试卷失败:`, error);
					throw error;
				}
			},
			{
				connection,
				concurrency: 10, // 同时处理10个学生的分发任务
			}
		);

		// Worker 事件监听
		worker.on("completed", (job) => {
			logger.info(`Worker: 学生练习试卷分发任务 ${job.id} 完成`);
		});

		worker.on("failed", (job, err) => {
			logger.error(`Worker: 学生练习试卷分发任务 ${job?.id} 失败: ${err.message}`);
		});

		workerInitialized = true;
		logger.info("练习分发试卷队列 Worker 已初始化");
	}

	// 使用filter钩子而不是action钩子，因为filter在操作发生前触发
	filter('exercises.items.update', async (payload: any, meta: any, context: any) => {
		// 只在状态变更为published时处理
		if (!payload || payload.status !== 'published') return payload;
		
		const exerciseId = meta.keys?.[0] || meta.key;
		
		if (!exerciseId) {
			logger.warn('无法获取有效的考试ID');
			return payload;
		}
		
		try {
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
			
			logger.info(`开始为练习ID: ${exerciseId} 使用消息队列进行异步批量发卷`);
			
			// 分开查询以避免嵌套查询的限制问题
			// 1. 获取练习的试卷数据
			const exerciseData = await exercisesService.readOne(exerciseId, {
				fields: [
					'id',
					'paper.paper_sections.id',
					'paper.paper_sections.points_per_question',
					'paper.paper_sections.questions.id',
					'paper.paper_sections.questions.questions_id.type',
					'paper.paper_sections.questions.questions_id.correct_ans_select_radio',
					'paper.paper_sections.questions.questions_id.correct_ans_select_multiple_checkbox',
				],
			});
			
			// 2. 单独查询所有学生（避免嵌套查询100条限制）
			const exercisesStudentsService = new ItemsService('exercises_students', serviceOptions);
			const studentsData = await exercisesStudentsService.readByQuery({
				filter: { exercises_id: { _eq: exerciseId } },
				fields: ['id'],
				limit: -1, // 获取所有学生
			});
			
			const paperSections = exerciseData?.paper?.paper_sections;
			const students = studentsData;
			
			if (!paperSections?.length) {
				logger.warn(`练习 ${exerciseId} 的试卷没有章节信息，发卷中止。`);
				return payload;
			}
			
			if (!students?.length) {
				logger.warn(`练习 ${exerciseId} 没有找到考生信息，发卷中止。`);
				return payload;
			}
			
			logger.info(`练习 ${exerciseId} 查询结果: 找到 ${students.length} 名学生`);
			
			// 从嵌套结构中提取并扁平化题目列表
			const questions = paperSections.flatMap((section: any) =>
				(section.questions || []).map((q: any) => ({
					...q,
					paper_sections_id: section.id,
				}))
			);
			
			if (!questions.length) {
				logger.warn(`练习 ${exerciseId} 的试卷没有题目信息，发卷中止。`);
				return payload;
			}
			
			// 构建章节与分值的映射表（转为普通对象以便序列化）
			const sectionPointsMap = Object.fromEntries(
				paperSections.map((sec: any) => [sec.id, sec.points_per_question])
			);
			
			logger.info(`准备为${students.length}名考生创建分发任务，每人${questions.length}道题目`);
			
			try {
				// 为每个学生创建分发任务并添加到队列
				const jobs = students.map((student: any) => ({
					name: `distribute-${exerciseId}-${student.id}`,
					data: {
						exerciseId,
						studentId: student.id,
						questions,
						sectionPointsMap,
						schema, // 传递schema给Worker
						accountability, // 传递accountability给Worker
					},
					opts: {
						attempts: 5, // 增加重试次数
						backoff: {
							type: "exponential",
							delay: 2000,
						},
						removeOnComplete: 10, // 保留最近10个完成的任务用于调试
						removeOnFail: 50,     // 保留最近50个失败的任务用于调试
					},
				}));

				logger.info(`准备为练习 ${exerciseId} 添加 ${jobs.length} 个分发任务到消息队列（学生IDs: ${students.map((s: any) => s.id).join(', ')}）`);

				// 批量添加任务到队列
				const addedJobs = await exerciseDistributeQueue.addBulk(jobs);
				logger.info(`成功为练习 ${exerciseId} 添加 ${addedJobs.length} 个分发任务到消息队列`);

				// 等待一小段时间让任务开始处理，然后检查队列状态
				setTimeout(async () => {
					try {
						const waiting = await exerciseDistributeQueue.getWaiting();
						const active = await exerciseDistributeQueue.getActive();
						const completed = await exerciseDistributeQueue.getCompleted();
						const failed = await exerciseDistributeQueue.getFailed();
						
						const exerciseWaiting = waiting.filter(job => job.data.exerciseId === exerciseId).length;
						const exerciseActive = active.filter(job => job.data.exerciseId === exerciseId).length;
						const exerciseCompleted = completed.filter(job => job.data.exerciseId === exerciseId).length;
						const exerciseFailed = failed.filter(job => job.data.exerciseId === exerciseId).length;
						
						logger.info(`练习 ${exerciseId} 队列状态检查: 等待=${exerciseWaiting}, 处理中=${exerciseActive}, 已完成=${exerciseCompleted}, 失败=${exerciseFailed}`);
						
						if (exerciseFailed > 0) {
							logger.error(`练习 ${exerciseId} 有 ${exerciseFailed} 个任务失败，请检查错误日志`);
							const failedJobs = failed.filter(job => job.data.exerciseId === exerciseId);
							failedJobs.forEach(job => {
								logger.error(`失败任务详情: Job ${job.id}, 学生 ${job.data.studentId}, 错误: ${job.failedReason}`);
							});
						}
					} catch (statusError) {
						logger.error(`检查练习 ${exerciseId} 队列状态时出错:`, statusError);
					}
				}, 5000); // 5秒后检查状态

			} catch (queueError: any) {
				logger.error(`添加任务到消息队列失败，回退到同步处理: ${queueError.message}`);
				
				// 回退到同步处理
				const sectionPointsMapSync = new Map(
					paperSections.map((sec: any) => [sec.id, sec.points_per_question])
				);

				logger.info(`回退方案: 为 ${students.length} 名学生同步创建练习会话和题目`);

				await database.transaction(async (trx) => {
					const trxServiceOptions = { schema, accountability, trx };
					const practiceSessionsService = new ItemsService('practice_sessions', trxServiceOptions);
					const questionResultsService = new ItemsService('question_results', trxServiceOptions);
					
					const allQuestionResults: any[] = [];
					
					for (const student of students) {
						// 1. 为每个学生创建练习会话
						const practiceSessionId = await practiceSessionsService.createOne({
							exercises_students_id: student.id
						}, { emitEvents: true });
						
						// 2. 准备该学生的所有答题记录
						const questionResultsBatch = questions.map((question: any) => ({
							practice_session_id: practiceSessionId,
							question_in_paper_id: question.id,
							question_type: question.questions_id?.type,
							correct_ans_select_radio: question.questions_id?.correct_ans_select_radio,
							correct_ans_select_multiple_checkbox: question.questions_id?.correct_ans_select_multiple_checkbox,
							point_value: sectionPointsMapSync.get(question.paper_sections_id) ?? 0
						}));
						
						allQuestionResults.push(...questionResultsBatch);
					}
					
					// 3. 一次性批量插入所有答题记录
					if (allQuestionResults.length > 0) {
						await questionResultsService.createMany(allQuestionResults, {
							emitEvents: true,
						});
					}
				});
				
				logger.info(`同步批量发卷完成（回退方案）：${exerciseId}`);
			}
			
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