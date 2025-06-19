import { defineEndpoint } from '@directus/extensions-sdk';
import IORedis from "ioredis";
import type { EndpointExtensionContext } from "@directus/extensions"; // For logger and services if needed

// Initialize Redis client
// Ensure your REDIS environment variable is set
const redis = new IORedis(process.env.REDIS!, {
	maxRetriesPerRequest: null,
});

const CACHE_NAMESPACE = "exam_session_info";

// Helper function to parse values retrieved from Redis
function parseRedisValue(value: string | null | undefined): any {
	if (value === null || value === undefined) {
		return value;
	}
	// Handle specific string representations stored by flattenObjectRecursive
	if (value === "undefined") return undefined;
	if (value === "null") return null;

	try {
		// Attempt to parse as JSON (handles numbers, booleans, arrays, and actual JSON objects stringified)
		return JSON.parse(value);
	} catch (e) {
		// If it's not valid JSON, return the string as is
		// This covers cases where a string was intentionally stored and is not "true", "false", "null", or a number.
		return value;
	}
}

export default defineEndpoint((router, context: EndpointExtensionContext) => {
	const { logger } = context;

	router.get("/:id", async (req, res) => {
		const examSessionId = req.params.id;
		const fieldsQuery = req.query.fields as string | undefined;

		if (!examSessionId) {
			return res
				.status(400)
				.json({ error: "Exam session ID is required." });
		}

		const hashKey = `${CACHE_NAMESPACE}:${examSessionId}`;

		try {
			const exists = await redis.exists(hashKey);
			if (!exists) {
				return res
					.status(404)
					.json({ error: "Exam session info not found in cache." });
			}

			let resultData: Record<string, any> = {};

			if (fieldsQuery && fieldsQuery.trim() !== "") {
				const fieldsArray = fieldsQuery.split(",").map((f) => f.trim()).filter(f => f); // Filter out empty strings

				if (fieldsArray.length > 0) {
					const values = await redis.hmget(hashKey, ...fieldsArray);
					fieldsArray.forEach((field, index) => {
						const fieldValue = values[index];
						// hmget returns null for fields that don't exist in the hash
						if (fieldValue !== null) {
							resultData[field] = parseRedisValue(fieldValue);
						} else {
							resultData[field] = null;
						}
					});
				} else {
					// If fieldsArray is empty after trim/filter (e.g. fields=" "), fetch all
					const allFields = await redis.hgetall(hashKey);
					for (const key in allFields) {
						resultData[key] = parseRedisValue(allFields[key]);
					}
				}
			} else {
				// No fields query param, or it's empty, fetch all
				const allFields = await redis.hgetall(hashKey);
				for (const key in allFields) {
					resultData[key] = parseRedisValue(allFields[key]);
				}
			}

			if (Object.keys(resultData).length === 0 && (!fieldsQuery || fieldsQuery.trim() === '' || (fieldsQuery.split(",").map((f) => f.trim()).filter(f => f).length > 0) )) {
				return res.status(404).json({
					message: "Cache entry found, but no data matched the specified criteria or the entry is empty.",
					data: {} // Return empty data object
				});
			}

			return res.json(resultData);
		} catch (error: any) {
			logger.error(
				error,
				`Error fetching exam session info for ID ${examSessionId} from cache:`
			);
			return res
				.status(500)
				.json({ error: "Internal server error while fetching data from cache." });
		}
	});

	// New route to fetch exam session info for a list of IDs
	router.post("/batch", async (req, res) => {
		const { exam_session_ids } = req.body;

		if (!Array.isArray(exam_session_ids) || exam_session_ids.some(id => typeof id !== 'string' || id.trim() === '')) {
			return res.status(400).json({ error: 'Request body must contain a "exam_session_ids" array with non-empty string IDs.' });
		}

		if (exam_session_ids.length === 0) {
			return res.json({}); // Return empty object if no IDs are provided
		}

		logger.info(`[ExamSessionInfoBatch] Batch fetching info for ${exam_session_ids.length} exam session IDs.`);

		try {
			const pipeline = redis.pipeline();
			exam_session_ids.forEach(id => {
				const hashKey = `${CACHE_NAMESPACE}:${id}`;
				pipeline.hgetall(hashKey); // hgetall will return an empty object if key doesn't exist
			});

			const results = await pipeline.exec();
			const responseData: Record<string, Record<string, any> | null> = {};

			if (results) {
				results.forEach((result, index) => {
					const currentSessionId = exam_session_ids[index];
					if (result[0]) { // Error for this hgetall command
						logger.error(result[0], `[ExamSessionInfoBatch] Error in pipeline fetching HGETALL for ES ID ${currentSessionId}:`);
						responseData[currentSessionId] = null; // Indicate error or not found
					} else {
						const sessionData = result[1] as Record<string, string>; // Data from HGETALL
						if (Object.keys(sessionData).length > 0) {
							const parsedSessionData: Record<string, any> = {};
							for (const key in sessionData) {
								parsedSessionData[key] = parseRedisValue(sessionData[key]);
							}
							responseData[currentSessionId] = parsedSessionData;
						} else {
							// Key might not exist, or hash is empty
							responseData[currentSessionId] = null; 
							logger.info(`[ExamSessionInfoBatch] No data found in cache for ES ID ${currentSessionId}.`);
						}
					}
				});
			}
            
			logger.info(`[ExamSessionInfoBatch] Successfully processed batch fetch for ${exam_session_ids.length} exam session IDs.`);
			return res.json(responseData);

		} catch (error: any) {
			logger.error(error, `[ExamSessionInfoBatch] Error during batch fetching exam session info:`);
			return res.status(500).json({ error: 'Internal server error while batch fetching data from cache.' });
		}
	});
}); 