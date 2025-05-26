import { defineHook } from "@directus/extensions-sdk";

export default defineHook(({ filter }, { services, logger }) => {
    const { ItemsService } = services;

    // 监听 question_results 的更新事件
    filter(
        "question_results.items.update",
        async (payload: any, meta: any, context: any) => {
            // 检查是否更新了答案字段
            const hasRadioAnswer =
                payload && "submit_ans_select_radio" in payload;
            const hasCheckboxAnswer =
                payload && "submit_ans_select_multiple_checkbox" in payload;

            // 如果没有提交答案，就不进行判分
            if (!hasRadioAnswer && !hasCheckboxAnswer) {
                return payload;
            }

            try {
                // 获取 question_result 的完整数据
                const questionResultId = meta.keys?.[0] || meta.key;
                if (!questionResultId) {
                    logger.warn("无法获取有效的答题记录ID");
                    return payload;
                }

                const accountability = context.accountability;
                const schema = context.schema;
                const serviceOptions = { schema, accountability };

                const questionResultsService = new ItemsService(
                    "question_results",
                    serviceOptions
                );

                // 读取完整的题目记录，包括正确答案和分值信息
                const questionResult = await questionResultsService.readOne(
                    questionResultId,
                    {
                        fields: [
                            "id",
                            "question_type",
                            "correct_ans_select_radio",
                            "correct_ans_select_multiple_checkbox",
                            "submit_ans_select_radio",
                            "submit_ans_select_multiple_checkbox",
                            "point_value",
                            "option_number",
                        ],
                    }
                );

                // 如果找不到记录，则返回原始payload
                if (!questionResult) {
                    logger.warn(`找不到答题记录: ${questionResultId}`);
                    return payload;
                }

                // 计算得分
                let score = 0;
                const questionType = questionResult.question_type;

                // 根据题目类型计算得分
                if (
                    questionType === "q_mc_single" ||
                    questionType === "q_mc_binary"
                ) {
                    // 单选题或二选题：必须完全匹配才得分
                    const submittedAnswer = hasRadioAnswer
                        ? payload.submit_ans_select_radio
                        : questionResult.submit_ans_select_radio;

                    if (
                        submittedAnswer ===
                        questionResult.correct_ans_select_radio
                    ) {
                        score = questionResult.point_value || 0;
                    }
                } else if (
                    questionType === "q_mc_multi" ||
                    questionType === "q_mc_flexible"
                ) {
                    // 多选题：完全匹配得满分，少选得部分分
                    const submittedAnswers = hasCheckboxAnswer
                        ? payload.submit_ans_select_multiple_checkbox
                        : questionResult.submit_ans_select_multiple_checkbox;

                    const correctAnswers =
                        questionResult.correct_ans_select_multiple_checkbox;

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
                        correctArray.every((answer: string) =>
                            submittedArray.includes(answer)
                        )
                    ) {
                        // 完全匹配，得满分
                        score = questionResult.point_value || 0;
                    } else {
                        // 少选，按比例得分
                        const optionNumber =
                            questionResult.option_number || correctArray.length;
                        const pointPerOption =
                            (questionResult.point_value || 0) / optionNumber;

                        // 计算正确选择的数量
                        const correctSelections = submittedArray.filter(
                            (answer: string) => correctArray.includes(answer)
                        ).length;
                        score = correctSelections * pointPerOption;
                    }
                }

                // 将得分添加到payload中
                payload.score = Math.round(score * 100) / 100; // 保留两位小数

                logger.info(
                    `完成自动判分: ID=${questionResultId}, 分数=${payload.score}, 类型=${questionType}`
                );

                return payload;
            } catch (error: unknown) {
                const errorMessage =
                    error instanceof Error ? error.message : "未知错误";
                logger.error(`自动判分过程中出错: ${errorMessage}`);
                return payload;
            }
        }
    );

    // 监听 practice_sessions 的更新：当 submit_status 变为 'done' 时，累加所有相关 question_results.score 到 practice_sessions.score
    filter(
        'practice_sessions.items.update',
        async (payload: any, meta: any, context: any) => {
            // 仅在 submit_status 更新为 'done' 时执行
            if (!payload || payload.submit_status !== 'done') {
                return payload;
            }

            // 获取当前 practice_session ID
            const practiceSessionId = meta.keys?.[0] || meta.key;
            if (!practiceSessionId) {
                logger.warn('无法获取有效的练习会话ID');
                return payload;
            }

            // 创建 question_results 服务
            const { accountability, schema } = context;
            const questionResultsService = new ItemsService('question_results', {
                accountability,
                schema,
            });

            // 查询所有属于该练习会话的答题记录，并获取各自的 score
            const results = await questionResultsService.readByQuery({
                filter: { practice_session_id: { _eq: practiceSessionId } },
                fields: ['score'],
                limit: -1,
            });

            // 累加所有得分，显式转换字符串类型，并处理 NaN
            const totalScore = results.reduce((sum: number, item: any) => {
                const raw = item.score;
                const val = raw == null
                    ? 0
                    : (typeof raw === 'string'
                        ? parseFloat(raw)
                        : raw);
                return sum + (isNaN(val) ? 0 : val);
            }, 0);

            // 将总分写入更新 payload
            payload.score = Math.round(totalScore * 100) / 100;

            return payload;
        }
    );
});
