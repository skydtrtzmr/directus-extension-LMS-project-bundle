import { defineEndpoint } from '@directus/extensions-sdk';
import IORedis from "ioredis";
import type { EndpointExtensionContext } from "@directus/extensions";

// Initialize Redis client
const redis = new IORedis(process.env.REDIS!, {
	maxRetriesPerRequest: null,
});

const CACHE_NAMESPACE = "practice_session_info";
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

export default defineEndpoint((router, { logger }: EndpointExtensionContext) => {
	router.patch("/:id", async (req, res) => {
		const practiceSessionId = req.params.id;
		const updatesFromBody = req.body;

		if (!practiceSessionId) {
			return res.status(400).json({ error: "Practice session ID is required in the path." });
		}

		if (typeof updatesFromBody !== 'object' || updatesFromBody === null || Object.keys(updatesFromBody).length === 0) {
			return res.status(400).json({ error: "Request body must be a non-empty JSON object containing fields to update." });
		}

		const hashKey = `${CACHE_NAMESPACE}:${practiceSessionId}`;

		try {
			const exists = await redis.exists(hashKey);
			if (!exists) {
				return res.status(404).json({ 
					error: `Practice session info with ID '${practiceSessionId}' not found in cache. Cannot update.` 
				});
			}

			const redisFieldUpdates: Record<string, string> = {};
			for (const key in updatesFromBody) {
				if (Object.prototype.hasOwnProperty.call(updatesFromBody, key)) {
					// Ensure keys are strings and values are stringified as per cache storage rules
					redisFieldUpdates[String(key)] = stringifyForRedisValue(updatesFromBody[key]);
				}
			}

			if (Object.keys(redisFieldUpdates).length === 0) {
				// This might happen if the input object was technically non-empty but contained no own-properties,
				// or if future logic filtered out all keys.
				return res.status(400).json({ error: "No valid fields to update were provided in the request body."});
			}

			const pipeline = redis.pipeline();
			pipeline.hmset(hashKey, redisFieldUpdates); // Update specified fields in the hash
			pipeline.expire(hashKey, CACHE_TTL_SECONDS);   // Refresh the TTL for the entire hash
			await pipeline.exec();

			logger.info(`Practice session info cache updated for ID: ${practiceSessionId}, Fields: ${Object.keys(redisFieldUpdates).join(', ')}`);
			return res.status(200).json({ 
				message: "Practice session info updated successfully in cache.",
				updatedCacheKey: hashKey,
				updatedFields: Object.keys(redisFieldUpdates) 
			});

		} catch (error: any) {
			logger.error(
				error, 
				`Error updating practice session info for ID '${practiceSessionId}' in cache:`
			);
			return res.status(500).json({ 
				error: "An internal server error occurred while updating the cache." 
			});
		}
	});
});
