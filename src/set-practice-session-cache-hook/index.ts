import { defineHook } from "@directus/extensions-sdk";
import IORedis from "ioredis";
import {
    setItemsToCache,
    cacheNestedListToRedisHashes,
} from "../utils/redisUtils";
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

        const fetchAndCachePracticeSessionResults = async () => {
            logger.info(
                "Fetching and caching all practice sessions' question results started..."
            );

            await cacheNestedListToRedisHashes(
                redis,
                "practice_session_qresults", // parentNamespace
                async () => {
                    // fetchParentItems
                    const practiceSessionsService = new ItemsService(
                        "practice_sessions",
                        { schema: await getSchema() }
                    );
                    return await practiceSessionsService.readByQuery({
                        fields: ["id"], // Only need the ID of the parent session here
                        limit: -1,
                    });
                },
                "id", // parentIdField (field in practice_session item for its ID)
                async (sessionItem) => {
                    // fetchChildItemsForParent
                    // sessionItem is one practice_session object, e.g., { id: 'some_session_id' }
                    const questionResultsService = new ItemsService(
                        "question_results",
                        { schema: await getSchema() }
                    );
                    return await questionResultsService.readByQuery({
                        filter: {
                            practice_session_id: { _eq: sessionItem.id }, // Filter children by parent ID
                        },
                        fields: [
                            "id",
                            "practice_session_id",
                            "question_in_paper_id",
                            "question_type",
                            "point_value",
                            "score",
                            "submit_ans_select_radio",
                            "submit_ans_select_multiple_checkbox",
                            "is_flagged",
                        ],
                        limit: -1,
                    });
                },
                "id", // childIdField (field in question_result item for its ID, to be used as Hash Field)
                3600 // ttl
            );
            logger.info(
                "Fetching and caching all practice sessions' question results completed."
            );
        };

        // 定时任务，例如每小时执行一次 (你可以调整 cron 表达式)
        // '0 * * * *' 表示每小时的第0分钟执行
        // '*/1 * * * *' 表示每1分钟执行一次，对于全量刷新可能过于频繁，请谨慎设置
        schedule("*/15 * * * *", async () => {
            // Example: every 15 minutes
            logger.info(
                "Scheduled practice_session QResults cache refresh triggered."
            );
            await fetchAndCachePracticeSessionResults();
        });

        // 应用初始化时预热缓存 (例如 'app.after' 表示 Directus 应用完全加载后)
        // 参考文档: https://docs.directus.io/guides/extensions/api-extensions/hooks.html#init-events
        init("app.after", async () => {
            logger.info(
                "Initial practice_session QResults cache warming triggered."
            );
            await fetchAndCachePracticeSessionResults();
        });

        // 对于更新触发的，需要另外写，因为这里的是拉去所有练习回话的答题结果。
        // 而我们需要根据发生变化的具体id来更新缓存。
    }
);
