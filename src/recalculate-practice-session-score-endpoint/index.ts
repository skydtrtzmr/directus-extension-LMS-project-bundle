import { defineEndpoint } from '@directus/extensions-sdk';
import type { EndpointExtensionContext } from "@directus/extensions";

export default defineEndpoint((router, context: EndpointExtensionContext) => {
    const { logger } = context;

    // POST /recalculate/:id - 重新计算指定练习会话的分数
    router.post("/:id", async (req, res) => {
        const practiceSessionId = req.params.id;

        if (!practiceSessionId) {
            return res.status(400).json({ 
                error: "Practice session ID is required." 
            });
        }

        try {
            // 从context中获取services，这些在运行时是可用的
            const { services, getSchema } = context as any;
            const { ItemsService } = services;
            const schema = await getSchema();
            const serviceOptions = { schema, accountability: (context as any).accountability };

            // 创建服务实例
            const questionResultsService = new ItemsService('question_results', serviceOptions);
            const practiceSessionsService = new ItemsService('practice_sessions', serviceOptions);

            logger.info(`开始重新计算练习会话 ${practiceSessionId} 的分数`);

            // 获取该练习会话下的所有question_results
            const questionResults = await questionResultsService.readByQuery({
                filter: { practice_session_id: { _eq: practiceSessionId } },
                fields: [
                    'id',
                    'question_type',
                    'correct_ans_select_radio',
                    'correct_ans_select_multiple_checkbox',
                    'submit_ans_select_radio',
                    'submit_ans_select_multiple_checkbox',
                    'point_value',
                    'option_number'
                ],
                limit: -1
            });

            if (!questionResults || questionResults.length === 0) {
                logger.warn(`练习会话 ${practiceSessionId} 下没有找到答题记录`);
                return res.status(404).json({
                    error: "No question results found for this practice session."
                });
            }

            logger.info(`找到 ${questionResults.length} 个答题记录，开始重新计算分数`);

            let totalScore = 0;
            const updatedQuestions = [];

            // 遍历每个question_result进行重新计算
            for (const questionResult of questionResults) {
                let score = 0;
                const questionType = questionResult.question_type;
                const questionId = questionResult.id;

                // 计算得分逻辑（参考automatic-grading-hook和exam-question-results-submit-queue-endpoint）
                if (questionType === "q_mc_single" || questionType === "q_mc_binary") {
                    // 单选题或二选题：必须完全匹配才得分
                    if (questionResult.submit_ans_select_radio === questionResult.correct_ans_select_radio) {
                        score = questionResult.point_value || 0;
                    }
                } else if (questionType === "q_mc_multi" || questionType === "q_mc_flexible") {
                    // 多选题：完全匹配得满分，少选得部分分
                    const submittedAnswers = questionResult.submit_ans_select_multiple_checkbox;
                    const correctAnswers = questionResult.correct_ans_select_multiple_checkbox;

                    // 如果答案是字符串，转换为数组进行比较
                    const submittedArray = Array.isArray(submittedAnswers)
                        ? submittedAnswers
                        : JSON.parse(submittedAnswers || "[]");
                    const correctArray = Array.isArray(correctAnswers)
                        ? correctAnswers
                        : JSON.parse(correctAnswers || "[]");

                    // 检查是否有错选
                    const hasWrongSelection = submittedArray.some(
                        (answer: string) => !correctArray.includes(answer)
                    );

                    if (hasWrongSelection) {
                        // 错选，得分为0
                        score = 0;
                    } else if (
                        submittedArray.length === correctArray.length &&
                        correctArray.every((answer: string) => submittedArray.includes(answer))
                    ) {
                        // 完全匹配，得满分
                        score = questionResult.point_value || 0;
                    } else {
                        // 少选，按比例得分
                        const optionNumber = questionResult.option_number || correctArray.length;
                        const pointPerOption = (questionResult.point_value || 0) / optionNumber;

                        // 计算正确选择的数量
                        const correctSelections = submittedArray.filter(
                            (answer: string) => correctArray.includes(answer)
                        ).length;
                        score = correctSelections * pointPerOption;
                    }
                }

                // 保留两位小数
                const finalScore = Math.round(score * 100) / 100;

                // 更新该question_result的分数
                await questionResultsService.updateOne(questionId, {
                    score: finalScore
                });

                totalScore += finalScore;
                updatedQuestions.push({
                    id: questionId,
                    type: questionType,
                    score: finalScore
                });

                logger.info(`题目 ${questionId} (${questionType}) 重新计算分数: ${finalScore}`);
            }

            // 计算总分并保留两位小数
            const finalTotalScore = Math.round(totalScore * 100) / 100;

            // 更新practice_session的总分
            await practiceSessionsService.updateOne(practiceSessionId, {
                score: finalTotalScore
            });

            logger.info(`练习会话 ${practiceSessionId} 分数重新计算完成，总分: ${finalTotalScore}`);

            // 返回结果
            return res.json({
                message: "Practice session score recalculated successfully.",
                practice_session_id: practiceSessionId,
                total_score: finalTotalScore,
                updated_questions_count: updatedQuestions.length,
                updated_questions: updatedQuestions
            });

        } catch (error: any) {
            logger.error(error, `重新计算练习会话 ${practiceSessionId} 分数时出错:`);
            return res.status(500).json({
                error: "Internal server error while recalculating practice session score.",
                details: error.message
            });
        }
    });

    // GET / - 健康检查路由
    router.get("/", (_req, res) => {
        res.json({
            message: "Practice Session Score Recalculation Endpoint is active.",
            usage: "POST /:id to recalculate scores for a practice session"
        });
    });
}); 