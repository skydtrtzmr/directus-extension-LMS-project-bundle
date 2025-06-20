import { defineHook } from "@directus/extensions-sdk";
import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";

// 初始化 Redis 连接和队列（模块级别）
const connection = new IORedis(process.env.REDIS!, {
    maxRetriesPerRequest: null,
});

const examDistributeQueue = new Queue("examDistributeQueue", { connection });

export default defineHook(({ filter }, { services, database, logger }) => {
    const { ItemsService } = services;

    // 初始化 Worker（只初始化一次）
    let workerInitialized = false;
    if (!workerInitialized) {
        const worker = new Worker(
            "examDistributeQueue",
            async (job) => {
                const { examId, studentId, questions, sectionPointsMap } = job.data;
                
                try {
                    logger.info(`Worker (job ${job.id}): 开始为学生 ${studentId} 分发考试 ${examId} 的试卷`);

                    // 创建服务实例 (Worker中需要重新创建)
                    const questionResultsService = new ItemsService("question_results", {
                        schema: job.data.schema,
                        accountability: job.data.accountability,
                    });

                    // 准备该学生的所有答题记录
                    const questionResultsBatch = questions.map((question: any) => ({
                        exam_student: studentId,
                        question_in_paper_id: question.id,
                        question_type: question.questions_id?.type,
                        correct_ans_select_radio: question.questions_id?.correct_ans_select_radio,
                        correct_ans_select_multiple_checkbox: question.questions_id?.correct_ans_select_multiple_checkbox,
                        point_value: sectionPointsMap[question.paper_sections_id] ?? 0,
                    }));

                    // 批量插入该学生的所有答题记录
                    await questionResultsService.createMany(questionResultsBatch, {
                        emitEvents: false,
                    });

                    logger.info(`Worker (job ${job.id}): 成功为学生 ${studentId} 分发 ${questionResultsBatch.length} 道题目`);

                } catch (error) {
                    logger.error(`Worker (job ${job.id}): 为学生 ${studentId} 分发试卷失败:`, error);
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
            logger.info(`Worker: 学生试卷分发任务 ${job.id} 完成`);
        });

        worker.on("failed", (job, err) => {
            logger.error(`Worker: 学生试卷分发任务 ${job?.id} 失败: ${err.message}`);
        });

        workerInitialized = true;
        logger.info("考试分发试卷队列 Worker 已初始化");
    }

    // 使用filter钩子而不是action钩子，因为filter在操作发生前触发
    filter(
        "exams.items.update",
        async (payload: any, meta: any, context: any) => {
            // 只在状态变更为published时处理
            if (!payload || payload.status !== "published") return payload;

            const examId = meta.keys?.[0] || meta.key;

            if (!examId) {
                logger.warn("无法获取有效的考试ID");
                return payload;
            }

            try {
                const accountability = context.accountability;
                const schema = context.schema;
                const serviceOptions = { schema, accountability };

                const examsService = new ItemsService("exams", serviceOptions);

                // 在filter钩子中，可以直接查询当前数据库中的状态，因为更新还未发生
                const examBeforeUpdate = await examsService
                    .readOne(examId, {
                        fields: ["status"],
                    })
                    .catch(() => null);

                // 只有当之前状态为draft时才执行发卷操作
                if (!examBeforeUpdate || examBeforeUpdate.status !== "draft") {
                    return payload;
                }

                logger.info(`开始为考试ID: ${examId} 使用消息队列进行异步批量发卷`);

                // 分开查询以避免嵌套查询的限制问题
                // 1. 获取考试的试卷数据
                const examData = await examsService.readOne(examId, {
                    fields: [
                        "id",
                        "paper.paper_sections.id",
                        "paper.paper_sections.points_per_question",
                        "paper.paper_sections.questions.id",
                        "paper.paper_sections.questions.questions_id.type",
                        "paper.paper_sections.questions.questions_id.correct_ans_select_radio",
                        "paper.paper_sections.questions.questions_id.correct_ans_select_multiple_checkbox",
                    ],
                });

                // 2. 单独查询所有学生（避免嵌套查询100条限制）
                const examsStudentsService = new ItemsService("exams_students", serviceOptions);
                const studentsData = await examsStudentsService.readByQuery({
                    filter: { exams_id: { _eq: examId } },
                    fields: ["id"],
                    limit: -1, // 获取所有学生
                });

                const paperSections = examData?.paper?.paper_sections;
                const students = studentsData;

                if (!paperSections?.length) {
                    logger.warn(`考试 ${examId} 的试卷没有章节信息，发卷中止。`);
                    return payload;
                }

                if (!students?.length) {
                    logger.warn(`考试 ${examId} 没有找到考生信息，发卷中止。`);
                    return payload;
                }

                logger.info(`考试 ${examId} 查询结果: 找到 ${students.length} 名学生`);

                // 从嵌套结构中提取并扁平化题目列表
                const questions = paperSections.flatMap((section: any) =>
                    (section.questions || []).map((q: any) => ({
                        ...q,
                        paper_sections_id: section.id,
                    }))
                );

                if (!questions.length) {
                    logger.warn(`考试 ${examId} 的试卷没有题目信息，发卷中止。`);
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
                        name: `distribute-${examId}-${student.id}`,
                        data: {
                            examId,
                            studentId: student.id,
                            questions,
                            sectionPointsMap,
                            schema, // 传递schema给Worker
                            accountability, // 传递accountability给Worker
                        },
                        opts: {
                            attempts: 3,
                            backoff: {
                                type: "exponential",
                                delay: 2000,
                            },
                        },
                    }));

                    // 批量添加任务到队列
                    await examDistributeQueue.addBulk(jobs);
                    logger.info(`成功为考试 ${examId} 添加 ${jobs.length} 个分发任务到消息队列`);

                } catch (queueError: any) {
                    logger.error(`添加任务到消息队列失败，回退到同步处理: ${queueError.message}`);
                    
                    // 回退到同步处理
                    const sectionPointsMapSync = new Map(
                        paperSections.map((sec: any) => [sec.id, sec.points_per_question])
                    );

                    await database.transaction(async (trx) => {
                        const trxServiceOptions = { schema, accountability, trx };
                        const questionResultsService = new ItemsService("question_results", trxServiceOptions);
                        const allQuestionResults: any[] = [];

                        for (const student of students) {
                            const questionResultsBatch = questions.map((question: any) => ({
                                exam_student: student.id,
                                question_in_paper_id: question.id,
                                question_type: question.questions_id?.type,
                                correct_ans_select_radio: question.questions_id?.correct_ans_select_radio,
                                correct_ans_select_multiple_checkbox: question.questions_id?.correct_ans_select_multiple_checkbox,
                                point_value: sectionPointsMapSync.get(question.paper_sections_id) ?? 0,
                            }));
                            allQuestionResults.push(...questionResultsBatch);
                        }

                        if (allQuestionResults.length > 0) {
                            await questionResultsService.createMany(allQuestionResults, { emitEvents: false });
                        }
                    });

                    logger.info(`同步批量发卷完成（回退方案）：${examId}`);
                }

                // 必须返回payload，这样更新操作才能继续
                return payload;
            } catch (error: unknown) {
                const errorMessage =
                    error instanceof Error ? error.message : "未知错误";
                logger.error(`批量发卷过程中出错: ${errorMessage}`);
                // 出错时也要返回payload，让更新操作继续
                return payload;
            }
        }
    );
});
