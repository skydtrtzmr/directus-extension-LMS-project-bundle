import { defineHook } from '@directus/extensions-sdk';
import IORedis from "ioredis";
import type {
	HookExtensionContext,
	RegisterFunctions,
} from "@directus/extensions";

// 概述：
// 这是一个反向索引，用于存储用户与考试会话的关联关系，便于根据用户ID查询其所有考试会话ID。

// 定义 exam_student 的相关数据结构，仅包含需要的字段
// 这有助于类型检查和代码可读性
interface StudentInfo {
	directus_user?: string | null;
}

interface ExamStudentItem {
	id: string | number;
	students_id?: StudentInfo | null;
}

// Initialize Redis client
// Ensure your REDIS environment variable is set, e.g., "redis://localhost:6379"
const redis = new IORedis(process.env.REDIS!, {
	maxRetriesPerRequest: null, // Important for handling Redis connection issues
	connectTimeout: 10000, // 10 seconds
});

redis.on('error', (err) => {
	// 使用 console.error 以便在 hookContext 不可用时也能打印
	console.error('[UserEsCacheHook] Redis connection error:', err);
});

export default defineHook(
	(
		{ init, schedule, action }: RegisterFunctions,
		hookContext: HookExtensionContext
	) => {
		const { services, getSchema, logger } = hookContext;
		const { ItemsService } = services;

		const CACHE_TTL_SECONDS = 3600 * 2; // 2 hours, adjust as needed
		const EXAM_STUDENT_COLLECTION = "exams_students";
		const REVERSE_INDEX_PREFIX = "user_es_index"; // Namespace for these keys

		// 仅获取构建反向索引所必需的字段
		const fieldsToFetch: string[] = [
			"id", // Exam Student ID
			"students_id.directus_user", // Path to the user ID
		];

		const fetchAndCacheUserExamSessions = async () => {
			logger.info(
				`[${REVERSE_INDEX_PREFIX}] Starting to fetch and cache user-specific exam session IDs.`
			);

			let examStudentsService: InstanceType<typeof ItemsService>;
			try {
				const schema = await getSchema();
				examStudentsService = new ItemsService(
					EXAM_STUDENT_COLLECTION,
					{ schema, accountability: { admin: true } as any }
				);
			} catch (schemaError) {
				logger.error(schemaError, `[${REVERSE_INDEX_PREFIX}] Error getting schema or initializing ItemsService:`);
				return;
			}

			try {
				const allExamStudents: ExamStudentItem[] =
					await examStudentsService.readByQuery({
						fields: fieldsToFetch,
						limit: -1, // Fetch all sessions
					});

				if (
					!allExamStudents ||
					allExamStudents.length === 0
				) {
					logger.info(
						`[${REVERSE_INDEX_PREFIX}] No exam students found. Indexing not performed.`
					);
					return;
				}

				logger.info(
					`[${REVERSE_INDEX_PREFIX}] Fetched ${allExamStudents.length} exam students. Processing for reverse index...`
				);

				// 使用 Map 存储 user_id -> Set<exam_student_id>
				const userToExamStudentsMap = new Map<string, Set<string>>();

				for (const examStudent of allExamStudents) {
					if (!examStudent || typeof examStudent.id === 'undefined' || examStudent.id === null) {
						logger.warn(`[${REVERSE_INDEX_PREFIX}] Encountered an exam student with missing or null ID. Skipping.`);
						continue;
					}
					const examStudentId = String(examStudent.id); // Ensure ID is a string

					const studentInfo = examStudent.students_id;
					const directusUserId = studentInfo?.directus_user;
					
					if (directusUserId && examStudentId) {
						if (!userToExamStudentsMap.has(directusUserId)) {
							userToExamStudentsMap.set(directusUserId, new Set<string>());
						}
						userToExamStudentsMap.get(directusUserId)!.add(examStudentId);
					}
				}

				if (userToExamStudentsMap.size === 0) {
					logger.info(`[${REVERSE_INDEX_PREFIX}] No user-to-exam_student associations found to cache.`);
					return;
				}

				logger.info(`[${REVERSE_INDEX_PREFIX}] Storing reverse indexes for ${userToExamStudentsMap.size} users.`);

				const pipeline = redis.pipeline();
				let commandsInPipeline = 0;

				for (const [userId, esIdsSet] of userToExamStudentsMap.entries()) {
					const userIndexKey = `${REVERSE_INDEX_PREFIX}:${userId}`;
					
					// 1. 清理旧的 Set (重要，确保索引是最新的)
					pipeline.del(userIndexKey);
					commandsInPipeline++;

					if (esIdsSet.size > 0) {
						// 2. 添加新的 ID 列表到 Set
						pipeline.sadd(userIndexKey, ...Array.from(esIdsSet));
						// 3. 设置过期时间
						pipeline.expire(userIndexKey, CACHE_TTL_SECONDS);
						commandsInPipeline += 2;
					}
				}
				
				if (commandsInPipeline > 0) {
					const results = await pipeline.exec();
					logger.info(
						`[${REVERSE_INDEX_PREFIX}] Redis pipeline executed for ${userToExamStudentsMap.size} users. Results length: ${results?.length || 0}.`
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
					`[${REVERSE_INDEX_PREFIX}] Finished caching user-specific exam session IDs for ${userToExamStudentsMap.size} users.`
				);

			} catch (error) {
				logger.error(
					error,
					`[${REVERSE_INDEX_PREFIX}] Error during fetchAndCacheUserExamSessions:`
				);
			}
		};

		// Schedule to run periodically (e.g., every 30 minutes)
		// CRON: min hour day(month) month day(week)
		const cronSchedule = process.env.USER_ES_CACHE_CRON_SCHEDULE || "*/30 * * * *";
		schedule(cronSchedule, async () => {
			logger.info(
				`[${REVERSE_INDEX_PREFIX}] Scheduled user exam session cache refresh triggered by cron (${cronSchedule}).`
			);
			await fetchAndCacheUserExamSessions();
		});

		// Run on application initialization (after app is ready)
		init("app.after", async () => {
			logger.info(
				`[${REVERSE_INDEX_PREFIX}] Initial user exam session cache warming triggered.`
			);
			await fetchAndCacheUserExamSessions();
		});

		// TODO 暂时注释掉了，不然分发时间的时候会疯狂触发。
		// action("exams_students.items.create", async (meta, context) => {
        //     logger.info(
        //         "Exam student created, triggering user exam session cache refresh."
        //     );
        //     await fetchAndCacheUserExamSessions();
        // });
	}
); 