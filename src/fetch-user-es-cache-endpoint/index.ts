import { defineEndpoint } from '@directus/extensions-sdk';
import IORedis from 'ioredis';
import type { EndpointExtensionContext } from '@directus/extensions'; // For logger type

// Initialize Redis client
// Ensure this configuration matches the one in set-user-es-cache-hook
const redis = new IORedis(process.env.REDIS!, {
	maxRetriesPerRequest: null,
	connectTimeout: 10000,
});

redis.on('error', (err) => {
	// Use console.error for situations where context might not be available
	console.error('[FetchUserEsCacheEndpoint] Redis connection error:', err);
});

const REVERSE_INDEX_PREFIX = "user_es_index";

export default defineEndpoint((router, context: EndpointExtensionContext) => {
	const { logger } = context;

	// Route to get exam session IDs for a single user
	router.get('/by-user/:userId', async (req, res) => {
		const { userId } = req.params;

		if (!userId || typeof userId !== 'string' || userId.trim() === '') {
			return res.status(400).json({ error: 'User ID is required in the path and must be a non-empty string.' });
		}

		const userIndexKey = `${REVERSE_INDEX_PREFIX}:${userId}`;
		logger.info(`[FetchUserEsCache] Fetching exam session IDs for user: ${userId}, Key: ${userIndexKey}`);

		try {
			const examSessionIds = await redis.smembers(userIndexKey);

			if (!examSessionIds) { // smembers returns string[] never null, but good practice
				logger.warn(`[FetchUserEsCache] No exam session IDs found for user: ${userId} (key not found or other Redis issue).`);
				return res.status(404).json({
					message: `No exam session IDs found in cache for user ID ${userId}. The user might not exist or have no associated sessions.`,
					userId: userId,
					examSessionIds: []
				});
			}
			
			logger.info(`[FetchUserEsCache] Successfully fetched ${examSessionIds.length} exam session IDs for user: ${userId}.`);
			return res.json({
				userId: userId,
				examSessionIds: examSessionIds // SMEMBERS returns an array of strings
			});

		} catch (error: any) {
			logger.error(error, `[FetchUserEsCache] Error fetching exam session IDs for user ${userId}:`);
			return res.status(500).json({ error: 'Failed to fetch exam session IDs from cache.' });
		}
	});

	// Route to get exam session IDs for multiple users
	router.post('/by-users', async (req, res) => {
		const { user_ids } = req.body;

		if (!Array.isArray(user_ids) || user_ids.some(id => typeof id !== 'string' || id.trim() === '')) {
			return res.status(400).json({ error: 'Request body must contain a "user_ids" array with non-empty string User IDs.' });
		}

		if (user_ids.length === 0) {
			return res.json({}); // Return empty object if no user_ids are provided
		}
		
		logger.info(`[FetchUserEsCache] Batch fetching exam session IDs for ${user_ids.length} users.`);

		try {
			const pipeline = redis.pipeline();
			user_ids.forEach(userId => {
				const userIndexKey = `${REVERSE_INDEX_PREFIX}:${userId}`;
				pipeline.smembers(userIndexKey);
			});

			const results = await pipeline.exec();
			const responseData: Record<string, string[]> = {};
			let usersProcessedCount = 0;

			if (results) {
				results.forEach((result, index) => {
					const currentUserId = user_ids[index];
					if (result[0]) { // Error for this smembers command
						logger.error(result[0], `[FetchUserEsCache] Error in pipeline fetching ES IDs for user ${currentUserId}:`);
						responseData[currentUserId] = []; // Or indicate error, e.g., null
					} else {
						// result[1] is the array of examSessionIds
						responseData[currentUserId] = result[1] as string[];
						usersProcessedCount++;
					}
				});
			}
			
			logger.info(`[FetchUserEsCache] Successfully processed batch fetch for ${usersProcessedCount}/${user_ids.length} users.`);
			return res.json(responseData);

		} catch (error: any) {
			logger.error(error, `[FetchUserEsCache] Error during batch fetching exam session IDs:`);
			return res.status(500).json({ error: 'Failed to batch fetch exam session IDs from cache.' });
		}
	});

	// Default route
	router.get('/', (_req, res) => {
		res.send('User Exam Sessions Cache API. Use /by-user/:userId or POST to /by-users with { "user_ids": [...] }.');
	});
}); 