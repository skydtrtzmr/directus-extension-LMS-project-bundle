import { defineHook } from '@directus/extensions-sdk';
import IORedis from "ioredis";
import { setFlattenedObjectToHash } from "../utils/redisUtils";
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
		{ init, schedule }: RegisterFunctions,
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

		const fetchAndCachePracticeSessionInfo = async () => {
			logger.info(
				`[${CACHE_NAMESPACE}] Starting to fetch and cache practice session info.`
			);

			try {
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
						`[${CACHE_NAMESPACE}] No practice sessions found to cache.`
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
	}
);
