// fetch-practice-session-cache-endpoint/index.ts
import { defineEndpoint } from '@directus/extensions-sdk';
import IORedis from 'ioredis'; // 确保你已经安装了 ioredis
import { scanKeysByPattern } from '../utils/redisUtils';
// 假设你的 HookExtensionContext 提供了 services, getSchema, logger
// 如果你需要 ItemsService 来从数据库回源，也需要导入它和相关类型
// import type { EndpointExtensionContext } from '@directus/extensions'; // 更准确的类型
// import { ItemsService } from '@directus/services'; // 如果需要回源

// 在模块顶层或合适的地方初始化 Redis 连接
// 确保这个 Redis 实例与你的 set-practice-session-qresults-cache-hook.ts 中使用的配置一致
const redis = new IORedis(process.env.REDIS!, {
    maxRetriesPerRequest: null,
    // 如果你的缓存和钩子在不同的 Redis DB，这里要指定正确的 db
    // db: 0, // 假设缓存在 db 0
});

export default defineEndpoint((router, context) => {
    // context 参数包含 services, database, getSchema, logger, env 等
    // const { services, getSchema, logger } = context;

    // GET /your-extension-route/practice_sessions_with_qresults_ids
    // 修改路由，用于获取所有包含缓存 qresults 的 practice_session 的 ID 列表
    router.get('/practice_sessions_with_qresults_ids', async (_req, res) => {
        try {
            // 新的缓存键格式: parentNamespace:parentId:childNamespace:childId
            // 例如: practice_session:some_session_id:qresult:some_qresult_id
            // 我们需要扫描 practice_session:*:qresult:* 来找出所有相关的键
            const pattern = 'practice_session:*:qresult:*';
            context.logger.info(`Scanning Redis for keys matching pattern: ${pattern}`);
            const keys = await scanKeysByPattern(redis, pattern, context.logger);
            
            // 从键中提取唯一的 sessionId
            const sessionIds = new Set<string>();
            keys.forEach(key => {
                const parts = key.split(':');
                // 期望格式: practice_session (0) : sessionId (1) : qresult (2) : qresultId (3)
                if (parts.length === 4 && parts[0] === 'practice_session' && parts[2] === 'qresult' && parts[1] !== undefined) {
                    sessionIds.add(parts[1]);
                }
            });

            context.logger.info(`Found ${sessionIds.size} unique session IDs with cached qresults.`);
            return res.json({ session_ids: Array.from(sessionIds) });
        } catch (error) {
            context.logger.error(error, "Error fetching practice session IDs from new cache structure");
            return res.status(500).json({ error: 'Failed to fetch practice session IDs' });
        }
    });

    // GET /your-extension-route/practice_session/:sessionId/qresults
    // 获取指定 practice_session 的所有 question_results
    router.get('/practice_session/:sessionId/qresults', async (req, res) => {
        const { sessionId: sessionIdFromParams } = req.params; // sessionIdFromParams is string | undefined

        // More robust check to ensure sessionId is a non-empty string
        if (typeof sessionIdFromParams !== 'string' || sessionIdFromParams.trim() === '') {
            return res.status(400).json({ error: 'Session ID is required and must be a non-empty string' });
        }
        
        // Now, sessionIdFromParams is definitely a non-empty string.
        // For clarity, assign it to a new variable with a clear type, though TS should infer it.
        const sessionId: string = sessionIdFromParams;

        // 缓存键的模式: practice_session:sessionId:qresult:*
        const cacheKeyPattern = `practice_session:${sessionId}:qresult:*`;
        context.logger.info(`Fetching qresults for session ID ${sessionId} using pattern: ${cacheKeyPattern}`);

        try {
            const qresultKeys = await scanKeysByPattern(redis, cacheKeyPattern, context.logger);

            if (!qresultKeys || qresultKeys.length === 0) {
                context.logger.info(`No qresult keys found for session ID ${sessionId} with pattern ${cacheKeyPattern}.`);
                return res.status(404).json({ 
                    message: `No question results found in cache for session ID ${sessionId}. It might not exist, have no results, or results may have expired.`,
                    data: [] // 返回空数组表示没有结果
                });
            }

            context.logger.info(`Found ${qresultKeys.length} qresult keys for session ID ${sessionId}. Fetching all...`);
            const pipeline = redis.pipeline();
            qresultKeys.forEach(key => pipeline.hgetall(key));
            const results = await pipeline.exec();

            const qResultsArray: any[] = [];
            if (results) {
                results.forEach((resultItem, index) => {
                    // resultItem is [error, data]
                    if (resultItem[0]) { // Error for this hgetall
                        context.logger.error(resultItem[0], `Error fetching HASH data for key ${qresultKeys[index]}`);
                    } else if (resultItem[1] && Object.keys(resultItem[1]).length > 0) {
                        // resultItem[1] is the hash object { field: value, ... }
                        // Potentially convert numbers back if they were stringified, though hgetall usually returns strings
                        // For now, assume directus/services will handle type coercion if this data is passed to them.
                        // Or, if clients expect specific types, parse them here.
                        // Example: resultItem[1].score = parseFloat(resultItem[1].score);
                        qResultsArray.push(resultItem[1]);
                    } else {
                        context.logger.warn(`No data or empty hash returned for key ${qresultKeys[index]}`);
                    }
                });
            }
            
            context.logger.info(`Successfully fetched ${qResultsArray.length} qresults for session ID ${sessionId}.`);
            return res.json(qResultsArray);

        } catch (error) {
            context.logger.error(error, `Error fetching question results for session ID ${sessionId} from new cache structure`);
            return res.status(500).json({ error: 'Failed to fetch question results from cache' });
        }
    });

    // 默认路由更新
    router.get('/', (_req, res) => {
        res.send('Practice Session QResults Cache API. Use /practice_session/:sessionId/qresults for specific session data, or /practice_sessions_with_qresults_ids to list sessions.');
    });
});
