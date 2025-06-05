import { defineEndpoint } from '@directus/extensions-sdk';
import IORedis from 'ioredis';
import type { EndpointExtensionContext } from '@directus/extensions'; // For logger type

// Initialize Redis client
// Ensure this configuration matches the one in set-user-ps-cache-hook
const redis = new IORedis(process.env.REDIS!, {
	maxRetriesPerRequest: null,
	connectTimeout: 10000,
});

redis.on('error', (err) => {
	// Use console.error for situations where context might not be available
	console.error('[FetchUserPsCacheEndpoint] Redis connection error:', err);
});

const REVERSE_INDEX_PREFIX = "user_ps_index";

export default defineEndpoint((router, context: EndpointExtensionContext) => {
	const { logger } = context;

	// Route to get practice session IDs for a single user
	router.get('/by-user/:userId', async (req, res) => {
		const { userId } = req.params;

		if (!userId || typeof userId !== 'string' || userId.trim() === '') {
			return res.status(400).json({ error: 'User ID is required in the path and must be a non-empty string.' });
		}

		const userIndexKey = `${REVERSE_INDEX_PREFIX}:${userId}`;
		logger.info(`[FetchUserPsCache] Fetching practice session IDs for user: ${userId}, Key: ${userIndexKey}`);

		try {
			const practiceSessionIds = await redis.smembers(userIndexKey);

			if (!practiceSessionIds) { // smembers returns string[] never null, but good practice
				logger.warn(`[FetchUserPsCache] No practice session IDs found for user: ${userId} (key not found or other Redis issue).`);
				return res.status(404).json({
					message: `No practice session IDs found in cache for user ID ${userId}. The user might not exist or have no associated sessions.`,
					userId: userId,
					practiceSessionIds: []
				});
			}
			
			logger.info(`[FetchUserPsCache] Successfully fetched ${practiceSessionIds.length} practice session IDs for user: ${userId}.`);
			return res.json({
				userId: userId,
				practiceSessionIds: practiceSessionIds // SMEMBERS returns an array of strings
			});

		} catch (error: any) {
			logger.error(error, `[FetchUserPsCache] Error fetching practice session IDs for user ${userId}:`);
			return res.status(500).json({ error: 'Failed to fetch practice session IDs from cache.' });
		}
	});

	// Route to get practice session IDs for multiple users
	router.post('/by-users', async (req, res) => {
		const { user_ids } = req.body;

		if (!Array.isArray(user_ids) || user_ids.some(id => typeof id !== 'string' || id.trim() === '')) {
			return res.status(400).json({ error: 'Request body must contain a "user_ids" array with non-empty string User IDs.' });
		}

		if (user_ids.length === 0) {
			return res.json({}); // Return empty object if no user_ids are provided
		}
		
		logger.info(`[FetchUserPsCache] Batch fetching practice session IDs for ${user_ids.length} users.`);

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
						logger.error(result[0], `[FetchUserPsCache] Error in pipeline fetching PS IDs for user ${currentUserId}:`);
						responseData[currentUserId] = []; // Or indicate error, e.g., null
					} else {
						// result[1] is the array of practiceSessionIds
						responseData[currentUserId] = result[1] as string[];
						usersProcessedCount++;
					}
				});
			}
			
			logger.info(`[FetchUserPsCache] Successfully processed batch fetch for ${usersProcessedCount}/${user_ids.length} users.`);
			return res.json(responseData);

		} catch (error: any) {
			logger.error(error, `[FetchUserPsCache] Error during batch fetching practice session IDs:`);
			return res.status(500).json({ error: 'Failed to batch fetch practice session IDs from cache.' });
		}
	});

	// Default route
	router.get('/', (_req, res) => {
		res.send('User Practice Sessions Cache API. Use /by-user/:userId or POST to /by-users with { "user_ids": [...] }.');
	});
});
