// set-practice-session-qresults-cache-hook/index.ts
import { defineHook } from "@directus/extensions-sdk";
import IORedis from "ioredis";
import { cacheNestedObjectsToIndividualRedisHashes, scanKeysByPattern, executeWithDistributedLock } from "../utils/redisUtils";
import type {
    HookExtensionContext,
    RegisterFunctions,
} from "@directus/extensions";
import { Queue, Worker } from "bullmq";

const redis = new IORedis(process.env.REDIS!, {
    maxRetriesPerRequest: null, // 适用于 Redis 连接本身
});

// 用于获取练习回话的答题结果

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
        interface PracticeSessionWithResults {
            id: string | number; // Or be more specific if you know the type of id
            question_results?: any[]; // question_results can be an array or undefined/null
            [key: string]: any; // To allow for other fields not explicitly typed
        }

        // 增量式地将新的或更新的答题结果哈希对象添加到缓存中
        const addOrUpdateQuestionResultHashesInCache = async (
            qrItems: any[],
            isUpdate: boolean = false
        ) => {
            if (!qrItems || qrItems.length === 0) {
                return;
            }

            // 按 practice_session_id 对答题结果进行分组
            const groupedBySession = qrItems.reduce((acc, qr) => {
                const sessionId = qr.practice_session_id;
                if (sessionId) {
                    if (!acc[sessionId]) {
                        acc[sessionId] = [];
                    }
                    acc[sessionId].push(qr);
                }
                return acc;
            }, {} as Record<string | number, any[]>);

            for (const sessionId in groupedBySession) {
                const qrsForSession = groupedBySession[sessionId];
                logger.info(
                    `${isUpdate ? "Updating" : "Incrementally caching"} ${
                        qrsForSession.length
                    } question result hashes for practice session ${sessionId}.`
                );

                const pipeline = redis.multi();

                for (const qr of qrsForSession) {
                    const key = `practice_session:${sessionId}:qresult:${qr.id}`;
                    
                    // 将对象转换为适合 HSET 的格式，所有值都转换为字符串
                    const hashData: { [key: string]: string } = {};
                    for (const [field, value] of Object.entries(qr)) {
                        if (value === null || value === undefined) {
                            // 跳过 null 或 undefined 值，这样它们就不会出现在哈希中
                            continue;
                        }
                        if (typeof value === 'string') {
                            hashData[field] = value;
                        } else {
                            // 对于数字、布尔值、数组和对象，使用 JSON.stringify
                            hashData[field] = JSON.stringify(value);
                        }
                    }

                    if (Object.keys(hashData).length > 0) {
                        // 使用 HSET 存储为哈希
                        pipeline.hset(key, hashData);
                        // 为键设置过期时间
                        pipeline.expire(key, CACHE_TTL_SECONDS);
                    }
                }

                try {
                    await pipeline.exec();
                    logger.info(
                        `Successfully ${isUpdate ? "updated" : "cached"} ${
                            qrsForSession.length
                        } QR hashes for session ${sessionId}.`
                    );
                } catch (error) {
                    logger.error(
                        error,
                        `Failed to execute ${
                            isUpdate ? "update" : "incremental cache"
                        } pipeline for session ${sessionId}.`
                    );
                }
            }
        };

        const fetchAndCachePracticeSessionResults = async () => {
            logger.info(
                "Fetching and caching all practice sessions' question results using individual hashes started..."
            );

            try {
                const practiceSessionsService = new ItemsService(
                    "practice_sessions",
                    { schema: await getSchema(), /* accountability: null */ } // accountability might be needed if permissions restrict deep reads
                );

                // Fetch parent items (practice_sessions) with their child items (question_results) deeply
                const allPracticeSessionsWithResults: PracticeSessionWithResults[] = await practiceSessionsService.readByQuery({
                    fields: [
                        "id",
                        "question_results.id",
                        "question_results.practice_session_id", // Though redundant if parent ID is known, good for completeness of child object
                        "question_results.question_in_paper_id",
                        "question_results.question_type",
                        "question_results.point_value",
                        "question_results.score",
                        "question_results.submit_ans_select_radio",
                        "question_results.submit_ans_select_multiple_checkbox",
                        "question_results.is_flagged",
                        "question_results.correct_ans_select_radio",
                        "question_results.correct_ans_select_multiple_checkbox",
                        // Add any other question_result fields you need to cache
                    ],
                    limit: -1, // Fetch all sessions
                });

                if (!allPracticeSessionsWithResults || allPracticeSessionsWithResults.length === 0) {
                    logger.info("No practice sessions found to cache.");
                    return;
                }
                
                // Filter out sessions that might not have question_results (if the deep query returns them as null/undefined)
                // And ensure question_results is an array
                const validPracticeSessions = allPracticeSessionsWithResults.filter(
                    (session: PracticeSessionWithResults) => Array.isArray(session.question_results)
                );


                await cacheNestedObjectsToIndividualRedisHashes<PracticeSessionWithResults, any>(
                    redis,
                    "practice_session", // parentNamespace
                    validPracticeSessions, // parentItems: array of practice_sessions, each with a question_results array
                    "id", // parentIdField
                    "question_results", // childListName (field in parentItem that contains children)
                    "qresult", // childNamespace
                    "id", // childIdField
                    CACHE_TTL_SECONDS, // ttlSeconds
                );

                logger.info(
                    "Fetching and caching all practice sessions' question results using individual hashes completed."
                );
            } catch (error) {
                logger.error(error, "Error during fetchAndCachePracticeSessionResults with individual hashes:");
            }
        };

        const fetchAndCacheSinglePracticeSession = async (practiceSessionId: string | number, schema: any) => {
            logger.info(`Fetching results to cache for single practice session ${practiceSessionId}...`);
            try {
                const questionResultsService = new ItemsService(
                    "question_results",
                    { schema, accountability: { admin: true } as any }
                );
        
                // Fetch all question_results for this session
                const allQuestionResultsForSession = await questionResultsService.readByQuery({
                    filter: {
                        practice_session_id: { _eq: practiceSessionId }
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
        
                if (!allQuestionResultsForSession || allQuestionResultsForSession.length === 0) {
                    logger.info(`No question results found for practice session ${practiceSessionId} to cache.`);
                    return;
                }
                
                await addOrUpdateQuestionResultHashesInCache(allQuestionResultsForSession, false);
                logger.info(`Successfully cached ${allQuestionResultsForSession.length} QRs for session ${practiceSessionId}.`);
        
            } catch (error) {
                logger.error(error, `Error during fetchAndCacheSinglePracticeSession for session ${practiceSessionId}:`);
                throw error; // Rethrow to let the job fail and be retried
            }
        };

        // 初始化缓存更新队列的 Worker
        let cacheWorkerInitialized = false;
        if (!cacheWorkerInitialized) {
            const worker = new Worker("practiceSessionCacheQueue", async (job) => {
                const { practiceSessionId, schema } = job.data;
                if (!practiceSessionId) {
                    logger.warn(`Cache worker received job ${job.id} without a practiceSessionId.`);
                    return;
                }
                logger.info(`Cache worker (job ${job.id}): processing practice session ${practiceSessionId}`);
                await fetchAndCacheSinglePracticeSession(practiceSessionId, schema);
            }, { connection: redis, concurrency: 5 });

            worker.on("completed", (job) => {
                logger.info(`Cache worker: job ${job.id} for session ${job.data.practiceSessionId} completed.`);
            });

            worker.on("failed", (job, err) => {
                logger.error(`Cache worker: job ${job?.id} for session ${job?.data.practiceSessionId} failed: ${err.message}`);
            });

            cacheWorkerInitialized = true;
            logger.info("Practice session cache worker initialized.");
        }

        // 定时任务，例如每小时执行一次 (你可以调整 cron 表达式)
        // '0 * * * *' 表示每小时的第0分钟执行
        // '*/1 * * * *' 表示每1分钟执行一次，对于全量刷新可能过于频繁，请谨慎设置
        // 注意这个是有过期时间的，所以如果你不全量更新的话，就一定会隔段时间没数据了。
        schedule("*/30 * * * *", async () => {
            // 使用分布式锁避免多进程重复执行
            const result = await executeWithDistributedLock(
                redis,
                "practice_session_qresults:schedule_lock",
                async () => {
                    logger.info(
                        "Scheduled practice_session QResults cache refresh triggered."
                    );
                    await fetchAndCachePracticeSessionResults();
                },
                300, // 5分钟锁定时间
                logger
            );

            if (result === null) {
                logger.info("Scheduled practice_session QResults cache refresh skipped (another process is handling it).");
            }
        });

        // 应用初始化时预热缓存 (例如 'app.after' 表示 Directus 应用完全加载后)
        // 参考文档: https://docs.directus.io/guides/extensions/api-extensions/hooks.html#init-events
        init("app.after", async () => {
            // 使用分布式锁避免多进程重复执行
            const result = await executeWithDistributedLock(
                redis,
                "practice_session_qresults:init_lock",
                async () => {
                    logger.info(
                        "Initial practice_session QResults cache warming triggered."
                    );
                    await fetchAndCachePracticeSessionResults();
                },
                300, // 5分钟锁定时间
                logger
            );

            if (result === null) {
                logger.info("Initial practice_session QResults cache warming skipped (another process is handling it).");
            }
        });

        // 监听答题结果更新事件，精确更新对应的缓存哈希
        action("question_results.items.update", async(meta, context) => {
            const updatedIds = meta.keys || [];
            if (updatedIds.length === 0) return;

            logger.info(
                `${updatedIds.length} question results updated, triggering cache update.`
            );

            try {
                const questionResultsService = new ItemsService(
                    "question_results",
                    {
                      schema: await getSchema(),
                      accountability: { admin: true } as any,
                    }
                  );
            
                  // 一次性读取所有更新的条目
                  const updatedQuestionResults = await questionResultsService.readMany(
                    updatedIds,
                    {
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
                    }
                  );
            
                  await addOrUpdateQuestionResultHashesInCache(
                      updatedQuestionResults,
                      true
                  );

            } catch (error) {
                logger.error(
                    error,
                    "Error in question_results.items.update hook for cache update:"
                  );
            }
        });

        // 存储要删除的练习会话ID，供后续清理缓存使用
        let practiceSessionsToDelete: (string | number)[] = [];

        // 监听练习删除事件，在删除前获取相关数据（因为删除practice_sessions是级联的）
        filter("exercises.items.delete", async (payload: any, meta: any, context: any) => {
            logger.info("Exercise deletion detected, preparing to get related practice session data.");
            
            try {
                const deletedExerciseIds = payload;
                if (!Array.isArray(deletedExerciseIds) || deletedExerciseIds.length === 0) {
                    logger.warn("No exercise IDs found in deletion event.");
                    return payload;
                }

                logger.info(`Processing deleted exercise IDs: ${deletedExerciseIds.join(", ")}`);

                // 查询这些练习对应的practice_sessions并存储
                const { accountability, schema } = context;
                const practiceSessionsService = new ItemsService(
                    "practice_sessions",
                    { schema, accountability }
                );

                try {
                    const relatedPracticeSessions = await practiceSessionsService.readByQuery({
                        fields: ["id"],
                        filter: {
                            'exercises_students_id': {
                                'exercises_id': {
                                    '_in': deletedExerciseIds
                                }
                            }
                        },
                        limit: -1
                    });

                    practiceSessionsToDelete = relatedPracticeSessions.map((session: any) => session.id);
                    logger.info(`Found ${practiceSessionsToDelete.length} related practice sessions to clean QResults cache for.`);
                } catch (queryError) {
                    logger.error(queryError, "Error querying related practice sessions:");
                    practiceSessionsToDelete = [];
                }

            } catch (error) {
                logger.error(error, "Error handling exercise deletion filter event for QResults cache:");
            }

            return payload; // 必须返回payload让删除操作继续
        });

        // 监听练习删除事件，清理相关的练习会话答题结果缓存（因为删除practice_sessions是级联的）
        action("exercises.items.delete", async (meta: any, context: any) => {
            logger.info("Exercise deletion completed, cleaning related practice session QResults cache.");
            
            try {
                if (practiceSessionsToDelete.length === 0) {
                    logger.info("No related practice sessions to clean QResults cache for.");
                    return;
                }

                // 删除相关的答题结果缓存
                for (const practiceSessionId of practiceSessionsToDelete) {
                    const pattern = `practice_session:${practiceSessionId}:qresult:*`;
                    const keys = await scanKeysByPattern(redis, pattern, logger);
                    if (keys.length > 0) {
                        await redis.del(keys);
                        logger.info(`Deleted ${keys.length} QResult cache keys for practice session ${practiceSessionId}`);
                    }
                }

                // 清理临时存储
                practiceSessionsToDelete = [];

            } catch (error) {
                logger.error(error, "Error cleaning QResults cache after exercise deletion:");
                // 清理临时存储
                practiceSessionsToDelete = [];
            }
        });
    }
);
