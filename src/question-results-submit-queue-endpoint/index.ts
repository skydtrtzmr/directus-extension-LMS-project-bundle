import { defineEndpoint } from "@directus/extensions-sdk";
import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";

// ## 初始化 BullMQ 连接和队列 (模块级)
const connection = new IORedis(process.env.REDIS!, {
    maxRetriesPerRequest: null, // 适用于 Redis 连接本身
});

const answerQueue = new Queue("answerQueue", { connection });

// ## Directus Endpoint 定义
export default defineEndpoint({
    id: "question-results-mq", // 建议使用更具描述性的 ID
    handler: async (router, context: any) => {
        // handler 可以是 async

        const { services, getSchema, accountability } = context;
        const { ItemsService } = services;
        const itemsService = new ItemsService("question_results", {
            schema: await getSchema(),
            accountability: accountability,
        });

        // ### 定义 Worker
        const worker = new Worker(
            "answerQueue",
            async (job) => {
                const { collection, id, item } = job.data;
                try {
                    console.log(
                        `Worker (job ${job.id}): Processing for questionId: ${id}`
                    );
                    const updatedItemKey = await itemsService.updateOne(id, {
                        submit_ans_select_radio: item.submit_ans_select_radio,
                        submit_ans_select_multiple_checkbox:
                            item.submit_ans_select_multiple_checkbox,
                    });

                    console.log("updatedItemKey:", updatedItemKey);
                    

                    // 在 BullMQ 的 Worker 中，只要在 async (job) => { ... } 这个处理函数内部向上抛出了一个未被捕获的错误 (error)，BullMQ 就会将该 job 的当前尝试判定为失败 (failed)。
                    if (!updatedItemKey) {
                        console.error(
                            `Worker (job ${job.id}): Update for questionId: ${id} returned an unexpected null or empty response. Considering it as a failure.`
                        );
                        throw new Error(`Update operation for ${id} returned an unexpected response.`);
                    }

                    console.log(
                        `Worker (job ${job.id}): Successfully updated questionId: ${id}. Response:`, updatedItemKey
                    );
                } catch (error) {
                    console.error(
                        `Worker (job ${job.id}): Error processing task for questionId: ${id}`,
                        error
                    );
                    throw error; // 确保错误向上抛出，以便 BullMQ 知道任务失败并根据配置处理
                }
            },
            {
                connection,
                concurrency: 5
                // 可以考虑增加并发数，例如: concurrency: 5
            }
        );

        worker.on("completed", (job) => {
            console.log(
                `Worker: Job ${job.id} (questionId: ${job.data?.id}) has completed!`
            );
        });

        worker.on("failed", (job, err) => {
            // 避免在 "Directus context not available yet" 时记录过多重复日志，因为这是预期的瞬时状态
            if (
                err.message !==
                "Directus context not available yet, retrying task."
            ) {
                console.error(
                    `Worker: Job ${job?.id} (questionId: ${job?.data?.id}) has failed after retries with error: ${err.message}`
                );
            } else {
                // 可以选择在这里记录一个更轻量级的日志，或者不记录，因为 BullMQ 会处理重试
                console.warn(
                    `Worker: Job ${job?.id} failed because Directus context was not ready, BullMQ will retry.`
                );
            }
        });
        console.log(
            "Directus Endpoint Initialized: Services and getSchema are now available for the worker."
        );

        // API 端点用于接收任务，并添加到队列
        router.post("/question_result", async (req, res) => {
            const data = req.body;
            console.log("Endpoint: /question_result received data:", data);

            // console.log("req:", req);

            if (!data.collection || !data.id || !data.item) {
                console.warn(
                    "Endpoint: /question_result received invalid data:",
                    data
                );
                return res.status(400).send({
                    error: "Request body must contain collection, id, and item.",
                });
            }

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
                console.log(
                    `Endpoint: Job for questionId ${data.id} added to queue.`
                );
                res.send({
                    message:
                        "Question result received and queued for processing.",
                    received_data: data,
                });
            } catch (e: any) {
                console.error("Endpoint: Failed to add job to queue", e);
                res.status(500).send({ error: "Failed to queue the request." });
            }

            return true;
        });

        // 可选：添加一个简单的 GET 路由用于测试 Endpoint 是否加载
        router.get("/", (_req, res) =>
            res.send("Question Results Processor Endpoint is active.")
        );
    },
});
