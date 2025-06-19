import { defineHook } from "@directus/extensions-sdk";
import IORedis from "ioredis";
import { cacheNestedObjectsToIndividualRedisHashes } from "../utils/redisUtils";
import type {
    HookExtensionContext,
    RegisterFunctions,
} from "@directus/extensions";

const redis = new IORedis(process.env.REDIS!, {
    maxRetriesPerRequest: null, // 适用于 Redis 连接本身
});

// 用于获取考试会话的答题结果

export default defineHook(
    (
        { filter, action, init, schedule }: RegisterFunctions,
        hookContext: HookExtensionContext
    ) => {
        const { services, getSchema, logger } = hookContext;
        const { ItemsService } = services;

        // Define CACHE_TTL_SECONDS, e.g., 1 hour
        const CACHE_TTL_SECONDS = 3600;

        // Define a type for better type safety with fetched session data
        interface ExamSessionWithResults {
            id: string | number; // Or be more specific if you know the type of id
            question_results?: any[]; // question_results can be an array or undefined/null
            [key: string]: any; // To allow for other fields not explicitly typed
        }

        const fetchAndCacheExamSessionResults = async () => {
            logger.info(
                "Fetching and caching all exam sessions' question results using individual hashes started..."
            );

            try {
                const examStudentsService = new ItemsService(
                    "exams_students",
                    { schema: await getSchema(), /* accountability: null */ } // accountability might be needed if permissions restrict deep reads
                );

                // Fetch parent items (exams_students) with their child items (question_results) deeply
                const allExamSessionsWithResults: ExamSessionWithResults[] = await examStudentsService.readByQuery({
                    fields: [
                        "id",
                        "question_results.id",
                        "question_results.exam_student", // Though redundant if parent ID is known, good for completeness of child object
                        "question_results.question_in_paper_id",
                        "question_results.question_type",
                        "question_results.point_value",
                        "question_results.score",
                        "question_results.submit_ans_select_radio",
                        "question_results.submit_ans_select_multiple_checkbox",
                        "question_results.is_flagged",
                        // Add any other question_result fields you need to cache
                    ],
                    limit: -1, // Fetch all sessions
                });

                if (!allExamSessionsWithResults || allExamSessionsWithResults.length === 0) {
                    logger.info("No exam sessions found to cache.");
                    return;
                }
                
                // Filter out sessions that might not have question_results (if the deep query returns them as null/undefined)
                // And ensure question_results is an array
                const validExamSessions = allExamSessionsWithResults.filter(
                    (session: ExamSessionWithResults) => Array.isArray(session.question_results)
                );

                await cacheNestedObjectsToIndividualRedisHashes<ExamSessionWithResults, any>(
                    redis,
                    "exam_session", // parentNamespace
                    validExamSessions, // parentItems: array of exam_sessions, each with a question_results array
                    "id", // parentIdField
                    "question_results", // childListName (field in parentItem that contains children)
                    "qresult", // childNamespace
                    "id", // childIdField
                    CACHE_TTL_SECONDS, // ttlSeconds
                );

                logger.info(
                    "Fetching and caching all exam sessions' question results using individual hashes completed."
                );
            } catch (error) {
                logger.error(error, "Error during fetchAndCacheExamSessionResults with individual hashes:");
            }
        };

        // 定时任务，例如每小时执行一次 (你可以调整 cron 表达式)
        // '0 * * * *' 表示每小时的第0分钟执行
        // '*/1 * * * *' 表示每1分钟执行一次，对于全量刷新可能过于频繁，请谨慎设置
        // 注意这个是有过期时间的，所以如果你不全量更新的话，就一定会隔段时间没数据了。
        schedule("*/30 * * * *", async () => {
            // Example: every 30 minutes
            logger.info(
                "Scheduled exam_session QResults cache refresh triggered."
            );
            await fetchAndCacheExamSessionResults();
        });

        // 应用初始化时预热缓存 (例如 'app.after' 表示 Directus 应用完全加载后)
        // 参考文档: https://docs.directus.io/guides/extensions/api-extensions/hooks.html#init-events
        init("app.after", async () => {
            logger.info(
                "Initial exam_session QResults cache warming triggered."
            );
            await fetchAndCacheExamSessionResults();
        });

        // 注意，如果是用扩展创建的exam_students，需要专门写上emit才能触发这个钩子。
        // action("exams_students.items.create", async (meta, context) => {
        //     logger.info(
        //         "Exam session created, triggering QResults cache refresh."
        //     );
        //     await fetchAndCacheExamSessionResults();
        // });

        // 对于更新触发的，需要另外写，因为这里的是拉去所有考试会话的答题结果。
        // 而我们需要根据发生变化的具体id来更新缓存。
    }
); 