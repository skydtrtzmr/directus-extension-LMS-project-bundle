import { defineHook } from '@directus/extensions-sdk';
import IORedis from "ioredis";
import type {
	HookExtensionContext,
	RegisterFunctions,
} from "@directus/extensions";

// 概述：
// 这是一个反向索引，用于存储用户与练习会话的关联关系，便于根据用户ID查询其所有练习会话ID。

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
		{ init, schedule, action, filter }: RegisterFunctions,
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
						// `[${REVERSE_INDEX_PREFIX}] Redis pipeline executed for ${userToPracticeSessionsMap.size} users. Results length: ${results?.length || 0}.`
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

		// 增量更新单个用户的练习会话缓存
		const addPracticeSessionToUserCache = async (practiceSessionId: string, userId: string) => {
			if (!practiceSessionId || !userId) {
				logger.warn(`[${REVERSE_INDEX_PREFIX}] 无效的参数: practiceSessionId=${practiceSessionId}, userId=${userId}`);
				return;
			}

			try {
				const userIndexKey = `${REVERSE_INDEX_PREFIX}:${userId}`;
				
				// 使用 SADD 添加新的 practice_session_id 到用户的集合中
				// SADD 是幂等的，重复添加相同元素不会有问题
				await redis.sadd(userIndexKey, practiceSessionId);
				
				// 更新过期时间
				await redis.expire(userIndexKey, CACHE_TTL_SECONDS);
				
				logger.info(`[${REVERSE_INDEX_PREFIX}] 成功为用户 ${userId} 添加练习会话 ${practiceSessionId} 到缓存`);
			} catch (error) {
				logger.error(error, `[${REVERSE_INDEX_PREFIX}] 为用户 ${userId} 添加练习会话 ${practiceSessionId} 到缓存时出错:`);
			}
		};

		// 从用户缓存中移除练习会话
		const removePracticeSessionFromUserCache = async (practiceSessionId: string, userId: string) => {
			if (!practiceSessionId || !userId) {
				logger.warn(`[${REVERSE_INDEX_PREFIX}] 无效的参数: practiceSessionId=${practiceSessionId}, userId=${userId}`);
				return;
			}

			try {
				const userIndexKey = `${REVERSE_INDEX_PREFIX}:${userId}`;
				
				// 使用 SREM 从用户的集合中移除 practice_session_id
				const removed = await redis.srem(userIndexKey, practiceSessionId);
				
				if (removed > 0) {
					// 更新过期时间
					await redis.expire(userIndexKey, CACHE_TTL_SECONDS);
					logger.info(`[${REVERSE_INDEX_PREFIX}] 成功为用户 ${userId} 从缓存中移除练习会话 ${practiceSessionId}`);
				} else {
					logger.info(`[${REVERSE_INDEX_PREFIX}] 用户 ${userId} 的缓存中不存在练习会话 ${practiceSessionId}`);
				}
			} catch (error) {
				logger.error(error, `[${REVERSE_INDEX_PREFIX}] 为用户 ${userId} 从缓存中移除练习会话 ${practiceSessionId} 时出错:`);
			}
		};

		// 监听练习会话创建事件，实时更新用户缓存
		action("practice_sessions.items.create", async (meta, context) => {
			logger.info(`[${REVERSE_INDEX_PREFIX}] 检测到练习会话创建事件，开始处理缓存更新`);

			try {
				// 获取创建的练习会话ID
				const practiceSessionId = meta.key;
				if (!practiceSessionId) {
					logger.warn(`[${REVERSE_INDEX_PREFIX}] 无法获取练习会话ID`);
					return;
				}

				// 获取完整的练习会话数据以提取用户ID
				const { accountability, schema } = context;
				const practiceSessionsService = new ItemsService(PRACTICE_SESSION_COLLECTION, {
					schema,
					accountability,
				});

				const practiceSessionData = await practiceSessionsService.readOne(practiceSessionId, {
					fields: ["id", "exercises_students_id.students_id.directus_user"],
				});

				if (!practiceSessionData) {
					logger.warn(`[${REVERSE_INDEX_PREFIX}] 无法读取练习会话 ${practiceSessionId} 的数据`);
					return;
				}

				// 提取用户ID
				const esLink = practiceSessionData.exercises_students_id;
				let directusUserId: string | null = null;

				if (Array.isArray(esLink) && esLink.length > 0) {
					// 如果是数组，取第一个（通常应该只有一个）
					directusUserId = esLink[0]?.students_id?.directus_user;
				} else if (esLink && typeof esLink === 'object') {
					// 如果是单个对象
					directusUserId = esLink.students_id?.directus_user;
				}

				if (directusUserId) {
					// 增量添加到用户缓存
					await addPracticeSessionToUserCache(String(practiceSessionId), directusUserId);
				} else {
					logger.warn(`[${REVERSE_INDEX_PREFIX}] 练习会话 ${practiceSessionId} 无法找到关联的用户ID`);
				}

			} catch (error) {
				logger.error(error, `[${REVERSE_INDEX_PREFIX}] 处理练习会话创建事件时出错:`);
			}
		});

		// 存储要删除的练习会话ID，供后续清理缓存使用
		let practiceSessionsToDelete: (string | number)[] = [];

		// 监听练习删除事件，在删除前获取相关数据（因为删除practice_sessions是级联的）
		filter("exercises.items.delete", async (payload: any, meta: any, context: any) => {
			logger.info(`[${REVERSE_INDEX_PREFIX}] 检测到练习删除事件，准备获取相关练习会话数据`);

			try {
				// payload 包含要删除的练习ID数组
				const deletedExerciseIds = payload;
				if (!Array.isArray(deletedExerciseIds) || deletedExerciseIds.length === 0) {
					logger.warn(`[${REVERSE_INDEX_PREFIX}] 无法获取被删除的练习ID列表`);
					return payload;
				}

				logger.info(`[${REVERSE_INDEX_PREFIX}] 处理删除的练习ID: ${deletedExerciseIds.join(", ")}`);

				// 在删除之前，先查询这些练习对应的practice_sessions
				const { accountability, schema } = context;
				const practiceSessionsService = new ItemsService(PRACTICE_SESSION_COLLECTION, {
					schema,
					accountability,
				});

				// 查询所有相关的practice_sessions并存储
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
					logger.info(`[${REVERSE_INDEX_PREFIX}] 找到 ${practiceSessionsToDelete.length} 个相关的练习会话需要从缓存中移除`);
				} catch (queryError) {
					logger.error(queryError, `[${REVERSE_INDEX_PREFIX}] 查询相关练习会话时出错:`);
					practiceSessionsToDelete = [];
				}

			} catch (error) {
				logger.error(error, `[${REVERSE_INDEX_PREFIX}] 处理练习删除filter事件时出错:`);
			}

			return payload; // 必须返回payload让删除操作继续
		});

		// 在删除完成后清理缓存
		action("exercises.items.delete", async (meta: any, context: any) => {
			logger.info(`[${REVERSE_INDEX_PREFIX}] 练习删除完成，开始清理缓存`);

			try {
				if (practiceSessionsToDelete.length === 0) {
					logger.info(`[${REVERSE_INDEX_PREFIX}] 没有相关的练习会话需要清理缓存`);
					return;
				}

				// 从所有用户的缓存中移除这些practice_session_id
				const pattern = `${REVERSE_INDEX_PREFIX}:*`;
				const userCacheKeys = await redis.keys(pattern);

				if (userCacheKeys.length === 0) {
					logger.info(`[${REVERSE_INDEX_PREFIX}] 没有找到用户缓存，无需清理`);
					return;
				}

				let totalRemoved = 0;
				const pipeline = redis.pipeline();

				for (const userCacheKey of userCacheKeys) {
					for (const practiceSessionId of practiceSessionsToDelete) {
						// 批量移除操作
						pipeline.srem(userCacheKey, String(practiceSessionId));
					}
				}

				const results = await pipeline.exec();
				
				// 统计实际移除的数量
				if (results) {
					results.forEach((result) => {
						if (result && result[1] && typeof result[1] === 'number') {
							totalRemoved += result[1];
						}
					});
				}

				logger.info(`[${REVERSE_INDEX_PREFIX}] 从用户缓存中总共移除了 ${totalRemoved} 个练习会话引用`);

				// 清理临时存储
				practiceSessionsToDelete = [];

			} catch (error) {
				logger.error(error, `[${REVERSE_INDEX_PREFIX}] 清理缓存时出错:`);
				// 清理临时存储
				practiceSessionsToDelete = [];
			}
		});
	}
);
