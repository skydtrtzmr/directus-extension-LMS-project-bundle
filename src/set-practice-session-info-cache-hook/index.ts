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
		{ init, schedule, action }: RegisterFunctions,
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
		// action("practice_sessions.items.create", async (meta, context) => {
		// 	logger.info(
        //         `[${CACHE_NAMESPACE}] Practice session created (ID: ${meta.key}), updating cache.`
        //     );
		// 	await updateSingleSessionInCache(meta.key);
		// });

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

		// [2025-06-07] 注意，item事件没法监控到关联字段的级联删除。
		// 比如，删除一个练习会话，会级联删除关联的练习结果。
		// 但是，item事件没法监控到这个级联删除。
		// 所以，我们需要使用collection事件来监控这个级联删除。
		action("practice_sessions.items.delete", async (meta, context) => {
			logger.info("delete meta", meta);
			if (!Array.isArray(meta.payload)) return;
			logger.info(
                `[${CACHE_NAMESPACE}] Practice sessions deleted (IDs: ${meta.payload.join(", ")}), removing from cache.`
            );
			await deleteSessionsFromCache(meta.payload);
		});
	}
);
