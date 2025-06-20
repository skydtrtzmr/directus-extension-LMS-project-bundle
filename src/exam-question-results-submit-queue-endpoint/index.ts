import { defineEndpoint } from "@directus/extensions-sdk";
import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";

// ## 初始化 BullMQ 连接和队列 (模块级)
const connection = new IORedis(process.env.REDIS!, {
    maxRetriesPerRequest: null,
});

const examAnswerQueue = new Queue("examAnswerQueue", { connection });

// ## Directus Endpoint 定义
export default defineEndpoint({
    id: "exam-question-results-mq",
    handler: async (router, context: any) => {
        const { services, getSchema, accountability, logger } = context;
        const { ItemsService } = services;

        // ### 定义 Worker
        // 使用全局变量确保 Worker 只初始化一次
        if (!(global as any).examAnswerWorkerInitialized) {
            const worker = new Worker(
                "examAnswerQueue",
                async (job) => {
                    const { id, item, schema, accountabilityFromJob } = job.data;
                    logger.info(`Exam Worker (job ${job.id}): Processing for questionId: ${id}`);

                    try {
                        const itemsService = new ItemsService("question_results", {
                            schema,
                            accountability: accountabilityFromJob,
                        });

                        // 1. 读取判分所需数据
                        const questionResult = await itemsService.readOne(id, {
                            fields: [
                                "id",
                                "question_type",
                                "correct_ans_select_radio",
                                "correct_ans_select_multiple_checkbox",
                                "point_value",
                                "option_number",
                            ],
                        });

                        if (!questionResult) {
                            throw new Error(`Could not find question_result with id ${id}`);
                        }

                        // 2. 计算得分
                        let score = 0;
                        const questionType = questionResult.question_type;

                        if (questionType === "q_mc_single" || questionType === "q_mc_binary") {
                            if (item.submit_ans_select_radio === questionResult.correct_ans_select_radio) {
                                score = questionResult.point_value || 0;
                            }
                        } else if (questionType === "q_mc_multi" || questionType === "q_mc_flexible") {
                            const submittedAnswers = item.submit_ans_select_multiple_checkbox;
                            const correctAnswers = questionResult.correct_ans_select_multiple_checkbox;
                            
                            const submittedArray = Array.isArray(submittedAnswers) ? submittedAnswers : JSON.parse(submittedAnswers || "[]");
                            const correctArray = Array.isArray(correctAnswers) ? correctAnswers : JSON.parse(correctAnswers || "[]");
                            
                            const hasWrongSelection = submittedArray.some((answer: string) => !correctArray.includes(answer));

                            if (hasWrongSelection) {
                                score = 0;
                            } else if (submittedArray.length === correctArray.length && correctArray.every((answer: string) => submittedArray.includes(answer))) {
                                score = questionResult.point_value || 0;
                            } else {
                                const optionNumber = questionResult.option_number || correctArray.length;
                                if(optionNumber > 0) {
                                    const pointPerOption = (questionResult.point_value || 0) / optionNumber;
                                    const correctSelections = submittedArray.filter((answer: string) => correctArray.includes(answer)).length;
                                    score = correctSelections * pointPerOption;
                                }
                            }
                        }

                        // 3. 一次性更新答案和分数
                        const finalScore = Math.round(score * 100) / 100;
                        const dataToUpdate = {
                            ...item, // 用户提交的答案
                            score: finalScore,
                        };

                        await itemsService.updateOne(id, dataToUpdate);

                        logger.info(`Exam Worker (job ${job.id}): Completed grading and update for ID=${id}. Score=${finalScore}, Type=${questionType}.`);

                    } catch (error) {
                        logger.error(`Exam Worker (job ${job.id}): Error processing task for questionId: ${id}`, error);
                        throw error;
                    }
                },
                {
                    connection,
                    concurrency: 10,
                }
            );

            worker.on("completed", (job) => {
                logger.info(`Exam Worker: Job ${job.id} (questionId: ${job.data?.id}) completed.`);
            });

            worker.on("failed", (job, err) => {
                logger.error(`Exam Worker: Job ${job?.id} (questionId: ${job?.data?.id}) failed: ${err.message}`);
            });

            (global as any).examAnswerWorkerInitialized = true;
            logger.info("Exam answer processing worker initialized.");
        }

        // API 端点仅用于接收任务并添加到队列
        router.post("/question_result", async (req, res) => {
            const data = req.body;

            if (!data.id || !data.item) {
                logger.warn("Endpoint: /exam_question_result received invalid data:", data);
                return res.status(400).send({
                    error: "Request body must contain id and item.",
                });
            }

            try {
                const schema = await getSchema();
                await examAnswerQueue.add("grade-exam-answer", {
                    id: data.id,
                    item: data.item,
                    schema: schema,
                    accountabilityFromJob: accountability
                }, {
                    attempts: 5,
                    backoff: {
                        type: "exponential",
                        delay: 2000,
                    },
                });

                logger.info(`Endpoint: Job for exam questionId ${data.id} added to queue.`);
                return res.status(202).send({ message: "Answer accepted for processing." });

            } catch (error) {
                logger.error("Endpoint: Failed to add job to exam queue:", error);
                return res.status(500).send({ error: "Could not queue answer for processing." });
            }
        });
    },
}); 