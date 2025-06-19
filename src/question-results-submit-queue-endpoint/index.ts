// question-results-submit-queue-endpoint/index.ts
import { defineEndpoint } from "@directus/extensions-sdk";
import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";

// ## 初始化 BullMQ 连接和队列 (模块级)
const connection = new IORedis(process.env.REDIS!, {
    maxRetriesPerRequest: null, // 适用于 Redis 连接本身
});

const answerQueue = new Queue("answerQueue", { connection });
const DEFAULT_CACHE_TTL = 3600; // 默认缓存TTL，与主缓存钩子一致

// ## Directus Endpoint 定义
export default defineEndpoint({
    id: "question-results-mq", // 建议使用更具描述性的 ID
    handler: async (router, context: any) => {
        // handler 可以是 async

        const { services, getSchema, accountability, logger } = context; // Added logger from context
        const { ItemsService } = services;
        const itemsService = new ItemsService("question_results", {
            schema: await getSchema(),
            accountability: accountability,
        });

        // ### 定义 Worker
        const worker = new Worker(
            "answerQueue",
            async (job) => {
                const { collection, id, item } = job.data; // collection is not used here but good for context
                try {
                    logger.info(
                        // Using Directus logger
                        `Worker (job ${job.id}): Processing for questionId: ${id}`
                    );
                    
                    // 第一步：更新答案字段到数据库
                    const updatedItemKey = await itemsService.updateOne(id, {
                        submit_ans_select_radio: item.submit_ans_select_radio,
                        submit_ans_select_multiple_checkbox:
                            item.submit_ans_select_multiple_checkbox,
                        // 【重要】Worker 中只更新了这两个字段。
                        // 如果 data.item 包含更多字段，它们已在提交时被写入缓存，
                        // 但数据库层面只会由这里的 updateOne 更新指定字段。
                        // 如果需要 worker 更新更多字段，需要在这里添加。
                    });

                    // console.log("updatedItemKey:", updatedItemKey); // Replaced by logger

                    // 在 BullMQ 的 Worker 中，只要在 async (job) => { ... } 这个处理函数内部向上抛出了一个未被捕获的错误 (error)，BullMQ 就会将该 job 的当前尝试判定为失败 (failed)。
                    if (!updatedItemKey) {
                        logger.error(
                            // Using Directus logger
                            `Worker (job ${job.id}): Update for questionId: ${id} returned an unexpected null or empty response. Considering it as a failure.`
                        );
                        throw new Error(
                            `Update operation for ${id} returned an unexpected response.`
                        );
                    }

                    logger.info(
                        `Worker (job ${job.id}): Successfully updated questionId: ${id}. Response:`,
                        updatedItemKey
                    );

                    // 第二步：立即进行自动评分（在同一个事务中确保一致性）
                    try {
                        const questionResult = await itemsService.readOne(id, {
                            fields: [
                                "id",
                                "question_type",
                                "correct_ans_select_radio",
                                "correct_ans_select_multiple_checkbox", 
                                "submit_ans_select_radio",
                                "submit_ans_select_multiple_checkbox",
                                "point_value",
                                "option_number",
                                "practice_session_id",
                            ],
                        });

                        if (!questionResult) {
                            logger.warn(`Worker (job ${job.id}): 找不到答题记录: ${id}`);
                            return; // 数据库更新成功，但无法读取完整记录，不影响主流程
                        }

                        // 计算得分逻辑（从automatic-grading-hook移植）
                        let score = 0;
                        const questionType = questionResult.question_type;

                        if (
                            questionType === "q_mc_single" ||
                            questionType === "q_mc_binary"
                        ) {
                            // 单选题或二选题：必须完全匹配才得分
                            if (
                                questionResult.submit_ans_select_radio ===
                                questionResult.correct_ans_select_radio
                            ) {
                                score = questionResult.point_value || 0;
                            }
                        } else if (
                            questionType === "q_mc_multi" ||
                            questionType === "q_mc_flexible"
                        ) {
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

                        // 第三步：更新分数到数据库
                        const finalScore = Math.round(score * 100) / 100; // 保留两位小数
                        await itemsService.updateOne(id, {
                            score: finalScore
                        });

                        logger.info(
                            `Worker (job ${job.id}): 完成自动判分: ID=${id}, 分数=${finalScore}, 类型=${questionType}`
                        );

                        // 第四步：同步更新Redis缓存中的分数
                        try {
                            const practiceSessionId = questionResult.practice_session_id;
                            if (practiceSessionId) {
                                const childRedisKey = `practice_session:${practiceSessionId}:qresult:${id.toString()}`;
                                await connection.hset(childRedisKey, 'score', finalScore.toString());
                                await connection.expire(childRedisKey, DEFAULT_CACHE_TTL);
                                logger.info(
                                    `Worker (job ${job.id}): Score updated in Redis cache for key: ${childRedisKey}`
                                );
                            }
                        } catch (cacheError) {
                            logger.error(
                                `Worker (job ${job.id}): Failed to update score in Redis cache for questionId ${id}. Error:`,
                                cacheError
                            );
                            // 缓存更新失败不影响主流程
                        }

                    } catch (gradingError) {
                        logger.error(
                            `Worker (job ${job.id}): 自动判分过程中出错 for questionId ${id}:`,
                            gradingError
                        );
                        // 评分失败不影响答案提交的成功，但要记录错误以便后续处理
                        throw new Error(`Grading failed for question ${id}: ${gradingError}`);
                    }

                } catch (error) {
                    logger.error(
                        `Worker (job ${job.id}): Error processing task for questionId: ${id}`,
                        error
                    );
                    throw error; // 确保错误向上抛出，以便 BullMQ 知道任务失败并根据配置处理
                }
            },
            {
                connection,
                concurrency: 5,
            }
        );

        worker.on("completed", (job) => {
            logger.info(
                `Worker: Job ${job.id} (questionId: ${job.data?.id}) has completed!`
            );
        });

        worker.on("failed", (job, err) => {
            // 避免在 "Directus context not available yet" 时记录过多重复日志，因为这是预期的瞬时状态
            if (
                err.message !==
                "Directus context not available yet, retrying task."
            ) {
                logger.error(
                    `Worker: Job ${job?.id} (questionId: ${job?.data?.id}) has failed after retries with error: ${err.message}`
                );
            } else {
                // 可以选择在这里记录一个更轻量级的日志，或者不记录，因为 BullMQ 会处理重试
                logger.warn(
                    `Worker: Job ${job?.id} failed because Directus context was not ready, BullMQ will retry.`
                );
            }
        });
        logger.info(
            "Directus Endpoint Initialized: Services and getSchema are now available for the worker."
        );

        // API 端点用于接收任务，并添加到队列
        router.post("/question_result", async (req, res) => {
            const data = req.body;
            logger.info("Endpoint: /question_result received data.");

            if (!data.collection || !data.id || !data.item) {
                logger.warn(
                    "Endpoint: /question_result received invalid data:",
                    data
                );
                return res.status(400).send({
                    error: "Request body must contain collection, id, and item.",
                });
            }

            // --- 开始：直接写入 Redis 缓存 ---
            try {
                const questionResultItem = data.item; // This is the object with fields to update/set

                const questionResultId = data.id; // ID of the question_result item itself
                const practiceSessionId =
                    questionResultItem.practice_session_id;

                if (practiceSessionId && questionResultId) {
                    const childRedisKey = `practice_session:${practiceSessionId}:qresult:${questionResultId.toString()}`;

                    // 将 questionResultItem 对象转换为 { [key: string]: string } 形式以用于 hmset
                    // 确保所有值都是字符串，null 或 undefined 的值转换为空字符串
                    const itemToCache: { [key: string]: string } = {};
                    for (const key in questionResultItem) {
                        if (
                            Object.prototype.hasOwnProperty.call(
                                questionResultItem,
                                key
                            )
                        ) {
                            const value = questionResultItem[key];
                            if (value === null || value === undefined) {
                                itemToCache[key] = "";
                            } else if (typeof value === "object") {
                                // Covers arrays and plain objects
                                itemToCache[key] = JSON.stringify(value);
                            } else {
                                // Covers string, number, boolean, bigint, symbol
                                itemToCache[key] = String(value);
                            }
                        }
                    }

                    if (Object.keys(itemToCache).length > 0) {
                        await connection.hmset(childRedisKey, itemToCache);
                        await connection.expire(
                            childRedisKey,
                            DEFAULT_CACHE_TTL
                        );
                        logger.info(
                            `Endpoint: Question result ${questionResultId} for session ${practiceSessionId} directly written/updated in Redis cache (Key: ${childRedisKey}). Fields updated: ${Object.keys(
                                itemToCache
                            ).join(", ")}`
                        );
                    } else {
                        logger.warn(
                            `Endpoint: /question_result payload for ID ${questionResultId}, session ${practiceSessionId} resulted in an empty item map. Skipping direct Redis cache update. Data:`,
                            data
                        );
                    }
                } else {
                    logger.warn(
                        `Endpoint: /question_result payload for ID ${data.id} is missing practice_session_id in item data or questionResultId is missing. Skipping direct Redis cache update. Data:`,
                        data
                    );
                }
            } catch (cacheError) {
                logger.error(
                    `Endpoint: Failed to write to Redis cache for questionId ${data.id}. Error:`,
                    cacheError
                );
                // 缓存写入失败，但我们仍然继续将任务添加到队列
                // 这样可以保证数据最终会写入数据库，并在下一次全量缓存刷新时更新到缓存
            }
            // --- 结束：直接写入 Redis 缓存 ---

            try {
                // 将任务添加到队列，并配置重试策略
                await answerQueue.add("process-question-answer", data, {
                    attempts: 5, // BullMQ 任务重试次数
                    backoff: {
                        // BullMQ 退避策略
                        type: "exponential",
                        delay: 2000, // 初始延迟2秒 (可以根据情况调整)
                    },
                });
                logger.info(
                    `Endpoint: Job for questionId ${data.id} added to queue.`
                );
                res.send({
                    message:
                        "Question result received, cached, and queued for DB processing with automatic grading.",
                    received_data: data,
                });
            } catch (e: any) {
                logger.error("Endpoint: Failed to add job to queue", e);
                res.status(500).send({ error: "Failed to queue the request." });
            }
        });

        // 可选：添加一个简单的 GET 路由用于测试 Endpoint 是否加载
        router.get("/", (_req, res) =>
            res.send("Question Results Processor Endpoint with Automatic Grading is active.")
        );
    },
});