import { defineHook } from '@directus/extensions-sdk';
import IORedis from "ioredis";
import { setFlattenedObjectToHash, deleteKeysByPattern } from "../utils/redisUtils";
import type {
	HookExtensionContext,
	RegisterFunctions,
} from "@directus/extensions";

// Initialize Redis client
// Ensure your REDIS environment variable is set, e.g., "redis://localhost:6379"
const redis = new IORedis(process.env.REDIS!, {
	maxRetriesPerRequest: null, // Important for handling Redis connection issues
});

export default defineHook(
	(
		{ init, schedule, action, filter }: RegisterFunctions,
		hookContext: HookExtensionContext
	) => {
		const { services, getSchema, logger } = hookContext;
		const { ItemsService } = services;

		const CACHE_TTL_SECONDS = 3600; // 1 hour, adjust as needed
		const PRACTICE_SESSION_COLLECTION = "practice_sessions";
		const CACHE_NAMESPACE = "practice_session_info";
		const ID_FIELD = "id";

		const fieldsToFetch = [
			"id",
			"title",
			"exercises_students_id.exercises_id.title",
			"exercises_students_id.exercises_id.mode",
			"exercises_students_id.exercises_id.start_time",
			"exercises_students_id.exercises_id.end_time",
			"exercises_students_id.exercises_id.duration",
			"extra_time",
			"actual_end_time",
			"actual_start_time",
			"submit_status",
			"exercises_students_id.students_id.directus_user",
			"exercises_students_id.exercises_id.paper",
			"exercises_students_id.students_id.name",
			"exercises_students_id.students_id.number",
			"exercises_students_id.students_id.email",
			"exercises_students_id.students_id.class.name",
			"score",
			"expected_end_time",
		];

		const updateSingleSessionInCache = async (itemId: string | number) => {
			logger.info(
				`[${CACHE_NAMESPACE}] Updating single session (ID: ${itemId}) in cache.`
			);
			try {
				const practiceSessionsService = new ItemsService(
					PRACTICE_SESSION_COLLECTION,
					{ schema: await getSchema(), accountability: { admin: true } }
				);
				const sessionData = await practiceSessionsService.readOne(itemId, {
					fields: fieldsToFetch,
				});

				if (sessionData) {
					await setFlattenedObjectToHash(
						redis,
						CACHE_NAMESPACE,
						sessionData,
						ID_FIELD,
						CACHE_TTL_SECONDS
					);
					logger.info(
						`[${CACHE_NAMESPACE}] Successfully cached session (ID: ${itemId}).`
					);
				} else {
					logger.warn(
						`[${CACHE_NAMESPACE}] Session (ID: ${itemId}) not found, couldn't update cache.`
					);
				}
			} catch (error) {
				logger.error(
					error,
					`[${CACHE_NAMESPACE}] Error updating single session (ID: ${itemId}) in cache:`
				);
			}
		};

		const deleteSessionsFromCache = async (itemIds: (string | number)[]) => {
			logger.info(
				`[${CACHE_NAMESPACE}] Deleting sessions (IDs: ${itemIds.join(", ")}) from cache.`
			);
			if (itemIds.length === 0) return;
			try {
				const keysToDelete = itemIds.map(id => `${CACHE_NAMESPACE}:${id}`);
				await redis.del(keysToDelete);
				logger.info(
					`[${CACHE_NAMESPACE}] Successfully deleted sessions (IDs: ${itemIds.join(", ")}) from cache.`
				);
			} catch (error) {
				logger.error(
					error,
					`[${CACHE_NAMESPACE}] Error deleting sessions from cache:`
				);
			}
		};

		const fetchAndCachePracticeSessionInfo = async () => {
			logger.info(
				`[${CACHE_NAMESPACE}] Starting full refresh for practice session info.`
			);
			
			try {
				// Step 1: Clean up all old cache entries for this namespace
				const pattern = `${CACHE_NAMESPACE}:*`;
				logger.info(`[${CACHE_NAMESPACE}] Clearing all existing cache with pattern: ${pattern}`);
				await deleteKeysByPattern(redis, pattern, logger);


				// Step 2: Fetch all practice sessions from the database
				const practiceSessionsService = new ItemsService(
					PRACTICE_SESSION_COLLECTION,
					{ schema: await getSchema() }
				);

				const allPracticeSessions: Record<string, any>[] =
					await practiceSessionsService.readByQuery({
						fields: fieldsToFetch,
						limit: -1, // Fetch all sessions
					});

				if (
					!allPracticeSessions ||
					allPracticeSessions.length === 0
				) {
					logger.info(
						`[${CACHE_NAMESPACE}] No practice sessions found to cache. Full refresh finished.`
					);
					return;
				}

				logger.info(
					`[${CACHE_NAMESPACE}] Fetched ${allPracticeSessions.length} practice sessions. Starting to cache...`
				);

				let successfulCaches = 0;
				for (const sessionData of allPracticeSessions) {
					try {
						await setFlattenedObjectToHash(
							redis,
							// 拼接用户id与namespace，便于查询redis

							// TODO [2025-06-03] 以后来改，暂时不改了，因为需要改数据结构实在是太麻烦。
							// `directus_user:${sessionData.exercises_students_id.students_id.directus_user}:${CACHE_NAMESPACE}`,
							CACHE_NAMESPACE,
							sessionData,
							ID_FIELD,
							CACHE_TTL_SECONDS
						);
						successfulCaches++;
					} catch (itemError) {
						logger.error(
							itemError,
							`[${CACHE_NAMESPACE}] Error caching individual practice session (ID: ${sessionData[ID_FIELD] || 'N/A'}):`
						);
					}
				}

				logger.info(
					`[${CACHE_NAMESPACE}] Finished caching. ${successfulCaches}/${allPracticeSessions.length} practice sessions processed for caching.`
				);

			} catch (error) {
				logger.error(
					error,
					`[${CACHE_NAMESPACE}] Error during fetchAndCachePracticeSessionInfo:`
				);
			}
		};


		// 1. 全量更新缓存
		// Schedule to run every 30 minutes
		schedule("*/30 * * * *", async () => {
			logger.info(
				`[${CACHE_NAMESPACE}] Scheduled cache refresh triggered.`
			);
			await fetchAndCachePracticeSessionInfo();
		});

		// Run on application initialization
		init("app.after", async () => {
			logger.info(
				`[${CACHE_NAMESPACE}] Initial cache warming triggered.`
			);
			await fetchAndCachePracticeSessionInfo();
		});

		// 2. 增量更新缓存
		action("practice_sessions.items.create", async (meta, context) => {
			logger.info(
                `[${CACHE_NAMESPACE}] Practice session created (ID: ${meta.key}), updating cache.`
            );
			await updateSingleSessionInCache(meta.key);
		});

		action("practice_sessions.items.update", async (meta, context) => {
			logger.info("update meta", meta);
			if (!Array.isArray(meta.keys)) return;
			logger.info(
                `[${CACHE_NAMESPACE}] Practice sessions updated (IDs: ${meta.keys.join(", ")}), updating cache.`
            );
			for (const key of meta.keys) {
				await updateSingleSessionInCache(key);
			}
		});

		action("exercises.items.update", async (meta, context) => {
            const updatedExerciseIds = meta.keys;
            if (!Array.isArray(updatedExerciseIds) || updatedExerciseIds.length === 0) {
                logger.warn(`[${CACHE_NAMESPACE}] No exercise IDs found in update event.`);
                return;
            }

            logger.info(`[${CACHE_NAMESPACE}] Exercises updated (IDs: ${updatedExerciseIds.join(", ")}), preparing to update related practice session caches.`);

            try {
                const practiceSessionsService = new ItemsService(
                    PRACTICE_SESSION_COLLECTION,
                    { schema: await getSchema(), accountability: { admin: true } }
                );

                const relatedPracticeSessions = await practiceSessionsService.readByQuery({
                    fields: ["id"],
                    filter: {
                        'exercises_students_id': {
                            'exercises_id': {
                                '_in': updatedExerciseIds
                            }
                        }
                    },
                    limit: -1
                });

                if (relatedPracticeSessions.length === 0) {
                    logger.info(`[${CACHE_NAMESPACE}] No related practice sessions found for updated exercises (IDs: ${updatedExerciseIds.join(", ")}).`);
                    return;
                }

                const sessionIdsToUpdate = relatedPracticeSessions.map((session: any) => session.id);
                logger.info(`[${CACHE_NAMESPACE}] Found ${sessionIdsToUpdate.length} related practice sessions to update in cache.`);

                for (const sessionId of sessionIdsToUpdate) {
                    await updateSingleSessionInCache(sessionId);
                }

            } catch (error) {
                logger.error(error, `[${CACHE_NAMESPACE}] Error updating related practice sessions cache after exercise update:`);
            }
        });

		// 存储要删除的练习会话ID，供后续清理缓存使用
		let practiceSessionsToDelete: (string | number)[] = [];

		// 监听练习删除事件，在删除前获取相关数据（因为删除practice_sessions是级联的）
		filter("exercises.items.delete", async (payload: any, meta: any, context: any) => {
			logger.info(`[${CACHE_NAMESPACE}] Exercise deletion detected, preparing to get related practice session data.`);
			
			try {
				const deletedExerciseIds = payload;
				if (!Array.isArray(deletedExerciseIds) || deletedExerciseIds.length === 0) {
					logger.warn(`[${CACHE_NAMESPACE}] No exercise IDs found in deletion event.`);
					return payload;
				}

				logger.info(`[${CACHE_NAMESPACE}] Processing deleted exercise IDs: ${deletedExerciseIds.join(", ")}`);

				// 查询这些练习对应的practice_sessions并存储
				const { accountability, schema } = context;
				const practiceSessionsService = new ItemsService(
					PRACTICE_SESSION_COLLECTION,
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
					logger.info(`[${CACHE_NAMESPACE}] Found ${practiceSessionsToDelete.length} related practice sessions to remove from cache.`);
				} catch (queryError) {
					logger.error(queryError, `[${CACHE_NAMESPACE}] Error querying related practice sessions:`);
					practiceSessionsToDelete = [];
				}

			} catch (error) {
				logger.error(error, `[${CACHE_NAMESPACE}] Error handling exercise deletion filter event:`);
			}

			return payload; // 必须返回payload让删除操作继续
		});

		// 在删除完成后清理缓存
		action("exercises.items.delete", async (meta: any, context: any) => {
			logger.info(`[${CACHE_NAMESPACE}] Exercise deletion completed, cleaning cache.`);

			try {
				if (practiceSessionsToDelete.length === 0) {
					logger.info(`[${CACHE_NAMESPACE}] No related practice sessions to clean from cache.`);
					return;
				}

				await deleteSessionsFromCache(practiceSessionsToDelete);
				
				// 清理临时存储
				practiceSessionsToDelete = [];

			} catch (error) {
				logger.error(error, `[${CACHE_NAMESPACE}] Error cleaning cache after exercise deletion:`);
				// 清理临时存储
				practiceSessionsToDelete = [];
			}
		});
	}
);
