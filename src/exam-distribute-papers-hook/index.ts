import { defineHook } from "@directus/extensions-sdk";

export default defineHook(({ filter }, { services, database, logger }) => {
    const { ItemsService } = services;

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

                logger.info(`开始为考试ID: ${examId} 批量发卷流程`);

                // --- 优化1：合并数据查询 ---
                // 使用深度查询一次性获取所有需要的数据。
                const examData = await examsService.readOne(examId, {
                    fields: [
                        "students.id",
                        "paper.paper_sections.id",
                        "paper.paper_sections.points_per_question",
                        "paper.paper_sections.questions.id",
                        "paper.paper_sections.questions.questions_id.type",
                        "paper.paper_sections.questions.questions_id.correct_ans_select_radio",
                        "paper.paper_sections.questions.questions_id.correct_ans_select_multiple_checkbox",
                    ],
                });

                const paperSections = examData?.paper?.paper_sections;
                const students = examData?.students;

                if (!paperSections?.length) {
                    logger.warn(
                        `考试 ${examId} 的试卷没有章节信息，发卷中止。`
                    );
                    return payload;
                }

                if (!students?.length) {
                    logger.warn(`考试 ${examId} 没有找到考生信息，发卷中止。`);
                    return payload;
                }

                // 从嵌套结构中提取并扁平化题目列表
                const questions = paperSections.flatMap((section: any) =>
                    (section.questions || []).map((q: any) => ({
                        ...q,
                        paper_sections_id: section.id, // 保留章节ID用于后续查找分值
                    }))
                );

                if (!questions.length) {
                    logger.warn(
                        `考试 ${examId} 的试卷没有题目信息，发卷中止。`
                    );
                    return payload;
                }

                logger.info(
                    `准备为${students.length}名考生创建练习记录，每人${questions.length}道题目`
                );

                // 构建章节与分值的映射表
                const sectionPointsMap = new Map(
                    paperSections.map((sec: any) => [
                        sec.id,
                        sec.points_per_question,
                    ])
                );

                // [2025-06-17] TODO 把新增到practice session改为直接新增到exams_students。

                // --- 优化2: 批量数据插入 ---
                await database.transaction(async (trx) => {
                    const trxServiceOptions = { schema, accountability, trx };
                    const questionResultsService = new ItemsService(
                        "question_results",
                        trxServiceOptions
                    );

                    const allQuestionResults: any[] = [];

                    // 1. 准备该学生的所有答题记录
                    for (const student of students) {
                        const questionResultsBatch = questions.map(
                            (question: any) => ({
                                // practice_session_id: practiceSessionId,
                                exam_student: student.id,
                                question_in_paper_id: question.id,
                                question_type: question.questions_id?.type,
                                correct_ans_select_radio:
                                    question.questions_id
                                        ?.correct_ans_select_radio,
                                correct_ans_select_multiple_checkbox:
                                    question.questions_id
                                        ?.correct_ans_select_multiple_checkbox,
                                // 从映射表中取出对应章节的分值
                                point_value:
                                    sectionPointsMap.get(
                                        question.paper_sections_id
                                    ) ?? 0,
                            })
                        );

                        allQuestionResults.push(...questionResultsBatch);
                    }

                    // 2. 一次性批量插入所有答题记录
                    if (allQuestionResults.length > 0) {
                        await questionResultsService.createMany(
                            allQuestionResults,
                            {
                                emitEvents: false,
                            }
                        );
                    }
                });

                logger.info(`批量发卷成功完成：${examId}`);

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
