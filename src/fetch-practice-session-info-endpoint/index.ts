import { defineEndpoint } from '@directus/extensions-sdk';
import IORedis from "ioredis";
import type { EndpointExtensionContext } from "@directus/extensions"; // For logger and services if needed

// Initialize Redis client
// Ensure your REDIS environment variable is set
const redis = new IORedis(process.env.REDIS!, {
	maxRetriesPerRequest: null,
});

const CACHE_NAMESPACE = "practice_session_info";

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
		const practiceSessionId = req.params.id;
		const fieldsQuery = req.query.fields as string | undefined;

		if (!practiceSessionId) {
			return res
				.status(400)
				.json({ error: "Practice session ID is required." });
		}

		const hashKey = `${CACHE_NAMESPACE}:${practiceSessionId}`;

		try {
			const exists = await redis.exists(hashKey);
			if (!exists) {
				return res
					.status(404)
					.json({ error: "Practice session info not found in cache." });
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
				`Error fetching practice session info for ID ${practiceSessionId} from cache:`
			);
			return res
				.status(500)
				.json({ error: "Internal server error while fetching data from cache." });
		}
	});
});
