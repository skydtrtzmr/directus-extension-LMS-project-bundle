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
		const EXAM_STUDENT_COLLECTION = "exams_students";
		const CACHE_NAMESPACE = "exam_session_info";
		const ID_FIELD = "id";

		const fieldsToFetch = [
			"id",
			"exams_id.title",
			"exams_id.mode",
			"exams_id.start_time",
			"exams_id.end_time",
			"exams_id.duration",
			"extra_time",
			"actual_end_time",
			"actual_start_time",
			"submit_status",
			"students_id.directus_user",
			"exams_id.paper",
			"students_id.name",
			"students_id.number",
			"students_id.email",
			"students_id.class.name",
			"score",
			"expected_end_time",
		];

		const updateSingleSessionInCache = async (itemId: string | number) => {
			logger.info(
				`[${CACHE_NAMESPACE}] Updating single exam session (ID: ${itemId}) in cache.`
			);
			try {
				const examStudentsService = new ItemsService(
					EXAM_STUDENT_COLLECTION,
					{ schema: await getSchema(), accountability: { admin: true } }
				);
				const sessionData = await examStudentsService.readOne(itemId, {
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
						`[${CACHE_NAMESPACE}] Successfully cached exam session (ID: ${itemId}).`
					);
				} else {
					logger.warn(
						`[${CACHE_NAMESPACE}] Exam session (ID: ${itemId}) not found, couldn't update cache.`
					);
				}
			} catch (error) {
				logger.error(
					error,
					`[${CACHE_NAMESPACE}] Error updating single exam session (ID: ${itemId}) in cache:`
				);
			}
		};

		const deleteSessionsFromCache = async (itemIds: (string | number)[]) => {
			logger.info(
				`[${CACHE_NAMESPACE}] Deleting exam sessions (IDs: ${itemIds.join(", ")}) from cache.`
			);
			if (itemIds.length === 0) return;
			try {
				const keysToDelete = itemIds.map(id => `${CACHE_NAMESPACE}:${id}`);
				await redis.del(keysToDelete);
				logger.info(
					`[${CACHE_NAMESPACE}] Successfully deleted exam sessions (IDs: ${itemIds.join(", ")}) from cache.`
				);
			} catch (error) {
				logger.error(
					error,
					`[${CACHE_NAMESPACE}] Error deleting exam sessions from cache:`
				);
			}
		};

		const fetchAndCacheExamSessionInfo = async () => {
			logger.info(
				`[${CACHE_NAMESPACE}] Starting full refresh for exam session info.`
			);
			
			try {
				// Step 1: Clean up all old cache entries for this namespace
				const pattern = `${CACHE_NAMESPACE}:*`;
				logger.info(`[${CACHE_NAMESPACE}] Clearing all existing cache with pattern: ${pattern}`);
				await deleteKeysByPattern(redis, pattern, logger);

				// Step 2: Fetch all exam sessions from the database
				const examStudentsService = new ItemsService(
					EXAM_STUDENT_COLLECTION,
					{ schema: await getSchema() }
				);

				const allExamSessions: Record<string, any>[] =
					await examStudentsService.readByQuery({
						fields: fieldsToFetch,
						limit: -1, // Fetch all sessions
					});

				if (
					!allExamSessions ||
					allExamSessions.length === 0
				) {
					logger.info(
						`[${CACHE_NAMESPACE}] No exam sessions found to cache. Full refresh finished.`
					);
					return;
				}

				logger.info(
					`[${CACHE_NAMESPACE}] Fetched ${allExamSessions.length} exam sessions. Starting to cache...`
				);

				let successfulCaches = 0;
				for (const sessionData of allExamSessions) {
					try {
						await setFlattenedObjectToHash(
							redis,
							CACHE_NAMESPACE,
							sessionData,
							ID_FIELD,
							CACHE_TTL_SECONDS
						);
						successfulCaches++;
					} catch (itemError) {
						logger.error(
							itemError,
							`[${CACHE_NAMESPACE}] Error caching individual exam session (ID: ${sessionData[ID_FIELD] || 'N/A'}):`
						);
					}
				}

				logger.info(
					`[${CACHE_NAMESPACE}] Finished caching. ${successfulCaches}/${allExamSessions.length} exam sessions processed for caching.`
				);

			} catch (error) {
				logger.error(
					error,
					`[${CACHE_NAMESPACE}] Error during fetchAndCacheExamSessionInfo:`
				);
			}
		};

		// 1. 全量更新缓存
		// Schedule to run every 30 minutes
		schedule("*/30 * * * *", async () => {
			logger.info(
				`[${CACHE_NAMESPACE}] Scheduled cache refresh triggered.`
			);
			await fetchAndCacheExamSessionInfo();
		});

		// Run on application initialization
		init("app.after", async () => {
			logger.info(
				`[${CACHE_NAMESPACE}] Initial cache warming triggered.`
			);
			await fetchAndCacheExamSessionInfo();
		});

		// 2. 增量更新缓存
		action("exams_students.items.update", async (meta, context) => {
			logger.info("update meta", meta);
			if (!Array.isArray(meta.keys)) return;
			logger.info(
                `[${CACHE_NAMESPACE}] Exam sessions updated (IDs: ${meta.keys.join(", ")}), updating cache.`
            );
			for (const key of meta.keys) {
				await updateSingleSessionInCache(key);
			}
		});

		action("exams_students.items.delete", async (meta, context) => {
			logger.info("delete meta", meta);
			if (!Array.isArray(meta.payload)) return;
			logger.info(
                `[${CACHE_NAMESPACE}] Exam sessions deleted (IDs: ${meta.payload.join(", ")}), removing from cache.`
            );
			await deleteSessionsFromCache(meta.payload);
		});
	}
); 