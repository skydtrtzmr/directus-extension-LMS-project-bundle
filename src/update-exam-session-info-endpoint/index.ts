import { defineEndpoint } from '@directus/extensions-sdk';
import IORedis from "ioredis";
import { Queue, Worker } from "bullmq";
import type { EndpointExtensionContext } from "@directus/extensions";

// Initialize Redis client (for cache)
const redisCacheClient = new IORedis(process.env.REDIS!, {
	maxRetriesPerRequest: null,
	enableOfflineQueue: false, // Recommended for BullMQ connection to be distinct
});

// Initialize BullMQ Queue
const UPDATE_QUEUE_NAME = "exam-session-directus-update-queue";
const examSessionUpdateQueue = new Queue(UPDATE_QUEUE_NAME, {
	connection: redisCacheClient,
});

const CACHE_NAMESPACE = "exam_session_info";
// Use the same TTL as the cache creation hook, or make it configurable
const CACHE_TTL_SECONDS = 3600; 

// Helper function to stringify values consistently with flattenObjectRecursive
function stringifyForRedisValue(value: any): string {
	if (value === null) {
		return "null"; // Consistent with String(null)
	}
	if (value === undefined) {
		return "undefined"; // Consistent with String(undefined)
	}
	// Handles arrays and plain objects, consistent with JSON.stringify for arrays/objects
	if (typeof value === 'object') { 
		return JSON.stringify(value);
	}
	// Handles string, number, boolean, etc., consistent with String(value)
	return String(value);
}

export default defineEndpoint(
	async (router, context: EndpointExtensionContext) => {
		const { services, getSchema, logger } = context; // Removed accountability from direct context destructuring

		// ### 定义 Worker
		const examSessionUpdateWorker = new Worker(
			UPDATE_QUEUE_NAME,
			async (job) => {
				// jobAccountability is now expected to be of type 'any' or a known structure if possible
				const { examSessionId, updatesToApply, jobAccountability } = job.data as { examSessionId: string, updatesToApply: any, jobAccountability: any };
				logger.info(`Worker (Job ID: ${job.id}): Processing Directus update for exam_session ID: ${examSessionId}`);

				try {
					const itemsService = new services.ItemsService("exams_students", {
						schema: await getSchema(),
						// Pass jobAccountability; ItemsService will handle it (could be null)
						accountability: jobAccountability,
					});

					// IMPORTANT ASSUMPTION:
					// This assumes that `updatesToApply` (from req.body) contains field names
					// that can be directly used by `itemsService.updateOne()`.
					// If `updatesToApply` has flattened keys like "parent-child-field",
					// and Directus needs { parent: { child: { field: value } } } for update,
					// then a transformation (unflattening) step is needed here before calling updateOne.
					// For this example, we proceed with direct usage.
					const updatedItemKey = await itemsService.updateOne(examSessionId, updatesToApply);

					if (!updatedItemKey) {
						logger.error(`Worker (Job ID: ${job.id}): Directus update for exam_session ID: ${examSessionId} returned an unexpected null or empty response.`);
						throw new Error(`Directus update operation for ${examSessionId} returned an unexpected response.`);
					}

					logger.info(`Worker (Job ID: ${job.id}): Successfully updated exam_session ID: ${examSessionId} in Directus. Response: ${updatedItemKey}`);

				} catch (error: any) {
					logger.error(`Worker (Job ID: ${job.id}): Error processing Directus update for exam_session ID: ${examSessionId}. Error: ${error.message}`, error);
					throw error; // Re-throw to let BullMQ handle failure and retries
				}
			},
			{
				connection: redisCacheClient,
				concurrency: 5, // Adjust concurrency as needed
				// attempts: 3, // Default attempts for job retries
				// backoff: { type: 'exponential', delay: 1000 } // Default backoff strategy
			}
		);

		examSessionUpdateWorker.on("completed", (job) => {
			logger.info(`Worker: Job ${job.id} (exam_session ID: ${job.data?.examSessionId}) for Directus update has completed!`);
		});

		examSessionUpdateWorker.on("failed", (job, err) => {
			logger.error(`Worker: Job ${job?.id} (exam_session ID: ${job?.data?.examSessionId}) for Directus update has failed with error: ${err.message}`);
		});

		logger.info(`BullMQ Worker for queue '${UPDATE_QUEUE_NAME}' initialized and listening.`);

		// API 端点逻辑
		router.patch("/:id", async (req: any, res) => { // req as any to access req.accountability
			const examSessionId = req.params.id;
			const updatesFromBody = req.body;
			// jobAccountability is 'any' here as we can't import the specific type
			const jobAccountability: any = req.accountability || null;

			if (!examSessionId) {
				return res.status(400).json({ error: "Exam session ID is required in the path." });
			}

			if (typeof updatesFromBody !== 'object' || updatesFromBody === null || Object.keys(updatesFromBody).length === 0) {
				return res.status(400).json({ error: "Request body must be a non-empty JSON object containing fields to update." });
			}

			const hashKey = `${CACHE_NAMESPACE}:${examSessionId}`;

			try {
				const exists = await redisCacheClient.exists(hashKey);
				if (!exists) {
					logger.warn(`Cache entry for exam_session ID '${examSessionId}' not found. Update will only be queued for Directus.`);
				}

				const redisFieldUpdates: Record<string, string> = {};
				for (const key in updatesFromBody) {
					if (Object.prototype.hasOwnProperty.call(updatesFromBody, key)) {
						redisFieldUpdates[String(key)] = stringifyForRedisValue(updatesFromBody[key]);
					}
				}

				if (Object.keys(redisFieldUpdates).length === 0 && Object.keys(updatesFromBody).length > 0) {
					logger.warn(`Exam session ID '${examSessionId}': updatesFromBody had keys, but redisFieldUpdates is empty. This might indicate an issue with stringifyForRedisValue or input structure.`);
				}

				if (exists && Object.keys(redisFieldUpdates).length > 0) {
					const pipeline = redisCacheClient.pipeline();
					pipeline.hmset(hashKey, redisFieldUpdates);
					pipeline.expire(hashKey, CACHE_TTL_SECONDS);
					await pipeline.exec();
					logger.info(`Cache updated for exam_session ID: ${examSessionId}, Fields: ${Object.keys(redisFieldUpdates).join(', ')}`);
				} else if (!exists) {
					logger.info(`Cache for exam_session ID: ${examSessionId} did not exist. Cache not updated.`);
				} else {
					logger.info(`Cache for exam_session ID: ${examSessionId} exists, but no valid fields derived for cache update from body.`);
				}

				const jobName = `update-directus-exam-session-${examSessionId}`;
				await examSessionUpdateQueue.add(jobName, {
					examSessionId: examSessionId,
					updatesToApply: updatesFromBody,
					jobAccountability: jobAccountability // Pass accountability (as any)
				});
				logger.info(`Job '${jobName}' added to queue '${UPDATE_QUEUE_NAME}' for Directus update of exam_session ID: ${examSessionId}`);

				return res.status(200).json({
					message: "Exam session update processed: Cache updated (if applicable) and Directus update queued.",
					updatedCacheKey: exists && Object.keys(redisFieldUpdates).length > 0 ? hashKey : null,
					updatedCacheFields: exists && Object.keys(redisFieldUpdates).length > 0 ? Object.keys(redisFieldUpdates) : [],
					queuedJobName: jobName
				});

			} catch (error: any) {
				logger.error(error, `Error processing exam_session update for ID '${examSessionId}':`);
				return res.status(500).json({ error: "An internal server error occurred." });
			}
		});
	}
); 