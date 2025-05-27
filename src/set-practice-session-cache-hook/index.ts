import { defineHook } from "@directus/extensions-sdk";
import IORedis from "ioredis";
import { setItemsToCache } from "../utils/redisUtils";
import type {
    HookExtensionContext,
    RegisterFunctions,
} from "@directus/extensions";
import type { Query } from "@directus/types";

const redis = new IORedis(process.env.REDIS!, {
    maxRetriesPerRequest: null, // 适用于 Redis 连接本身
});

// 用于获取练习回话的答题结果
const comprehensivePracticeSessionFields = [
    "id",
    "question_results.practice_session_id",
    "question_results.question_in_paper_id",
    "question_results.question_type",
    "question_results.point_value",
    "question_results.score",
    "question_results.submit_ans_select_radio",
    "question_results.submit_ans_select_multiple_checkbox",
    "question_results.is_flagged",
];

export default defineHook(
    (
        { filter, action, init, schedule }: RegisterFunctions,
        hookContext: HookExtensionContext
    ) => {
        const { services, getSchema, logger } = hookContext;
        const { ItemsService } = services;

        // 共享的函数，用于获取并缓存试卷数据
        const fetchAndCachePracticeSessions = async () => {
            logger.info("Fetching and caching practice sessions question results started...");
            try {
                const currentSchema = await getSchema(); // 获取最新的 schema
                // 使用管理员权限 (省略 accountability) 来获取所有 practice_sessions
                const practice_sessionsService = new ItemsService("practice_sessions", {
                    schema: currentSchema,
                    // accountability: null, // 如果只需要公共数据，则使用 null
                });

                // 调用你的 redisUtils 中的函数来处理缓存
                // 注意：setItemsToCache 应该是一个 async 函数，这里使用 await
                await setItemsToCache(
                    redis,
                    "practice_sessions-question_results", // Redis 命名空间，键将是 "practice_sessions-question_results:id"
                    async () =>
                        await practice_sessionsService.readByQuery({
                            fields: comprehensivePracticeSessionFields,
                            limit: -1, // 获取所有项目
                        } as Query),
                    "id", // 对象中用作唯一ID的字段名
                    3600 // 缓存时间 (TTL)，例如1小时 (3600秒)。你可以根据需要调整。
                );
                logger.info(
                    "Fetching and caching practice_sessions completed successfully."
                );
            } catch (error) {
                logger.error(
                    error,
                    "Error occurred during fetchAndCachePracticeSessions:"
                );
            }
        };

        // 定时任务，例如每小时执行一次 (你可以调整 cron 表达式)
        // '0 * * * *' 表示每小时的第0分钟执行
        // '*/1 * * * *' 表示每1分钟执行一次，对于全量刷新可能过于频繁，请谨慎设置
        schedule("*/5 * * * *", async () => {
            // 例如，改为每5分钟
            logger.info("Scheduled practice_session cache refresh triggered.");
            await fetchAndCachePracticeSessions();
        });

        // 应用初始化时预热缓存 (例如 'app.after' 表示 Directus 应用完全加载后)
        // 参考文档: https://docs.directus.io/guides/extensions/api-extensions/hooks.html#init-events
        init("app.after", async ({ app }) => {
            // app 参数可用，但这里我们不需要它
            logger.info(
                "Initial practice_session cache warming triggered (on app.after)."
            );
            await fetchAndCachePracticeSessions();
        });

        // 对于更新触发的，需要另外写，因为这里的是拉去所有练习回话的答题结果。
        // 而我们需要根据发生变化的具体id来更新缓存。
    }
);
