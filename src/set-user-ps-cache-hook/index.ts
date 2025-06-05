import { defineHook } from '@directus/extensions-sdk';
import IORedis from "ioredis";
import type {
	HookExtensionContext,
	RegisterFunctions,
} from "@directus/extensions";

// 定义 practice_session 的相关数据结构，仅包含需要的字段
// 这有助于类型检查和代码可读性
interface StudentExerciseInfo {
	students_id?: {
		directus_user?: string | null;
	} | null;
}

interface PracticeSessionItem {
	id: string | number;
	// exercises_students_id 可以是一个对象，也可以是对象数组
	// 取决于 Directus 集合关系和查询的深度设置
	exercises_students_id?: StudentExerciseInfo | StudentExerciseInfo[] | null;
}

// Initialize Redis client
// Ensure your REDIS environment variable is set, e.g., "redis://localhost:6379"
const redis = new IORedis(process.env.REDIS!, {
	maxRetriesPerRequest: null, // Important for handling Redis connection issues
	connectTimeout: 10000, // 10 seconds
});

redis.on('error', (err) => {
	// 使用 console.error 以便在 hookContext 不可用时也能打印
	console.error('[UserPsCacheHook] Redis connection error:', err);
});


export default defineHook(
	(
		{ init, schedule }: RegisterFunctions,
		hookContext: HookExtensionContext
	) => {
		const { services, getSchema, logger } = hookContext;
		const { ItemsService } = services;

		const CACHE_TTL_SECONDS = 3600 * 2; // 2 hours, adjust as needed
		const PRACTICE_SESSION_COLLECTION = "practice_sessions";
		const REVERSE_INDEX_PREFIX = "user_ps_index"; // Namespace for these keys

		// 仅获取构建反向索引所必需的字段
		const fieldsToFetch: string[] = [
			"id", // Practice Session ID
			"exercises_students_id.students_id.directus_user", // Path to the user ID
		];

		const fetchAndCacheUserPracticeSessions = async () => {
			logger.info(
				`[${REVERSE_INDEX_PREFIX}] Starting to fetch and cache user-specific practice session IDs.`
			);

			let practiceSessionsService: InstanceType<typeof ItemsService>;
			try {
				const schema = await getSchema();
				practiceSessionsService = new ItemsService(
					PRACTICE_SESSION_COLLECTION,
					{ schema, accountability: { admin: true } as any }
				);
			} catch (schemaError) {
				logger.error(schemaError, `[${REVERSE_INDEX_PREFIX}] Error getting schema or initializing ItemsService:`);
				return;
			}

			try {
				const allPracticeSessions: PracticeSessionItem[] =
					await practiceSessionsService.readByQuery({
						fields: fieldsToFetch,
						limit: -1, // Fetch all sessions
					});

				if (
					!allPracticeSessions ||
					allPracticeSessions.length === 0
				) {
					logger.info(
						`[${REVERSE_INDEX_PREFIX}] No practice sessions found. Indexing not performed.`
					);
					return;
				}

				logger.info(
					`[${REVERSE_INDEX_PREFIX}] Fetched ${allPracticeSessions.length} practice sessions. Processing for reverse index...`
				);

				// 使用 Map 存储 user_id -> Set<practice_session_id>
				const userToPracticeSessionsMap = new Map<string, Set<string>>();

				for (const session of allPracticeSessions) {
					if (!session || typeof session.id === 'undefined' || session.id === null) {
						logger.warn(`[${REVERSE_INDEX_PREFIX}] Encountered a session with missing or null ID. Skipping.`);
						continue;
					}
					const practiceSessionId = String(session.id); // Ensure ID is a string

					const esLink = session.exercises_students_id;

					const processStudentExerciseInfo = (info: StudentExerciseInfo | null | undefined) => {
						const directusUserId = info?.students_id?.directus_user;
						if (directusUserId && practiceSessionId) {
							if (!userToPracticeSessionsMap.has(directusUserId)) {
								userToPracticeSessionsMap.set(directusUserId, new Set<string>());
							}
							userToPracticeSessionsMap.get(directusUserId)!.add(practiceSessionId);
						}
					};

					if (Array.isArray(esLink)) {
						esLink.forEach(processStudentExerciseInfo);
					} else if (esLink) { // Single object
						processStudentExerciseInfo(esLink);
					}
				}

				if (userToPracticeSessionsMap.size === 0) {
					logger.info(`[${REVERSE_INDEX_PREFIX}] No user-to-practice_session associations found to cache.`);
					return;
				}

				logger.info(`[${REVERSE_INDEX_PREFIX}] Storing reverse indexes for ${userToPracticeSessionsMap.size} users.`);

				const pipeline = redis.pipeline();
				let commandsInPipeline = 0;

				for (const [userId, psIdsSet] of userToPracticeSessionsMap.entries()) {
					const userIndexKey = `${REVERSE_INDEX_PREFIX}:${userId}`;
					
					// 1. 清理旧的 Set (重要，确保索引是最新的)
					pipeline.del(userIndexKey);
					commandsInPipeline++;

					if (psIdsSet.size > 0) {
						// 2. 添加新的 ID 列表到 Set
						pipeline.sadd(userIndexKey, ...Array.from(psIdsSet));
						// 3. 设置过期时间
						pipeline.expire(userIndexKey, CACHE_TTL_SECONDS);
						commandsInPipeline += 2;
					}
				}
				
				if (commandsInPipeline > 0) {
					const results = await pipeline.exec();
					logger.info(
						`[${REVERSE_INDEX_PREFIX}] Redis pipeline executed for ${userToPracticeSessionsMap.size} users. Results length: ${results?.length || 0}.`
					);
					 // Optional: Check pipeline results for errors
					if (results) {
						results.forEach((result, index) => {
							if (result && result[0]) { // result[0] is the error object
								logger.warn(`[${REVERSE_INDEX_PREFIX}] Error in pipeline command (index ${index}): `, result[0]);
							}
						});
					}
				} else {
					logger.info(`[${REVERSE_INDEX_PREFIX}] No commands were added to the pipeline (e.g. all user session sets were empty after potential DELs).`);
				}

				logger.info(
					`[${REVERSE_INDEX_PREFIX}] Finished caching user-specific practice session IDs for ${userToPracticeSessionsMap.size} users.`
				);

			} catch (error) {
				logger.error(
					error,
					`[${REVERSE_INDEX_PREFIX}] Error during fetchAndCacheUserPracticeSessions:`
				);
			}
		};

		// Schedule to run periodically (e.g., every 30 minutes)
		// CRON: min hour day(month) month day(week)
		const cronSchedule = process.env.USER_PS_CACHE_CRON_SCHEDULE || "*/30 * * * *";
		schedule(cronSchedule, async () => {
			logger.info(
				`[${REVERSE_INDEX_PREFIX}] Scheduled user practice session cache refresh triggered by cron (${cronSchedule}).`
			);
			await fetchAndCacheUserPracticeSessions();
		});

		// Run on application initialization (after app is ready)
		init("app.after", async () => {
			logger.info(
				`[${REVERSE_INDEX_PREFIX}] Initial user practice session cache warming triggered.`
			);
			await fetchAndCacheUserPracticeSessions();
		});
	}
);
