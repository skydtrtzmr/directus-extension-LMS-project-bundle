// fetch-practice-session-cache-endpoint/index.ts
import { defineEndpoint } from '@directus/extensions-sdk';
import IORedis from 'ioredis'; // 确保你已经安装了 ioredis
// 假设你的 HookExtensionContext 提供了 services, getSchema, logger
// 如果你需要 ItemsService 来从数据库回源，也需要导入它和相关类型
// import type { EndpointExtensionContext } from '@directus/extensions'; // 更准确的类型
// import { ItemsService } from '@directus/services'; // 如果需要回源

// 在模块顶层或合适的地方初始化 Redis 连接
// 确保这个 Redis 实例与你的 set-practice-session-cache-hook.ts 中使用的配置一致
const redis = new IORedis(process.env.REDIS!, {
    maxRetriesPerRequest: null,
    // 如果你的缓存和钩子在不同的 Redis DB，这里要指定正确的 db
    // db: 0, // 假设缓存在 db 0
});

export default defineEndpoint((router, context) => {
    // context 参数包含 services, database, getSchema, logger, env 等
    // const { services, getSchema, logger } = context;

    // GET /your-extension-route/practice_session_qresults (获取所有缓存的 session_qresults 的 session_id 列表 - 示例)
    // 注意：此路由列出的是 practice_session 的 ID，因为缓存键是 'practice_session_qresults:SESSION_ID'
    router.get('/practice_session_qresults', async (_req, res) => {
        try {
            // 示例：获取所有 'practice_session_qresults:*' 格式的键
            const sessionKeys = await redis.keys('practice_session_qresults:*');
            const sessionIds = sessionKeys.map(key => key.replace('practice_session_qresults:', ''));
            return res.json({ session_ids: sessionIds });
        } catch (error) {
            context.logger.error(error, "Error fetching practice session IDs from cache keys");
            return res.status(500).json({ error: 'Failed to fetch practice session IDs from cache' });
        }
    });

    // GET /your-extension-route/practice_session_qresults/:sessionId/qresults
    // 修改了路由以更清晰地表示获取的是某个 session 的 qresults
    // 旧路由: /practice_session_qresults/:id
    // 如果您希望保持旧路由 /practice_session_qresults/:id 来获取 qresults，可以将下面的 :sessionId/qresults 部分去掉
    // 并将 req.params.sessionId 替换为 req.params.id
    router.get('/practice_session_qresults/:sessionId/qresults', async (req, res) => {
        const sessionId = req.params.sessionId;

        if (!sessionId) {
            return res.status(400).json({ error: 'Session ID is required' });
        }

        // 缓存键的格式与 cacheNestedListToRedisHashes 中使用的 parentNamespace:parentId 一致
        const cacheKey = `practice_session_qresults:${sessionId}`;

        try {
            // 从 Redis Hash 中获取所有 question_results
            // hgetall 返回一个对象: { field1: value1, field2: value2, ... }
            // 在这里，field 是 question_result_id, value 是 question_result 的 JSON 字符串
            const cachedQResultsMap = await redis.hgetall(cacheKey);

            if (cachedQResultsMap && Object.keys(cachedQResultsMap).length > 0) {
                const qResultsArray = Object.values(cachedQResultsMap).map(qResultString => {
                    try {
                        return JSON.parse(qResultString);
                    } catch (parseError) {
                        context.logger.error(parseError, `Error parsing cached question result for session ID: ${sessionId}, data: ${qResultString}`);
                        // 如果单个解析失败，可以返回 null 或抛出错误，或者从结果中过滤掉
                        return null; 
                    }
                }).filter(qResult => qResult !== null); // 过滤掉解析失败的项目

                return res.json(qResultsArray);
            } else {
                // 缓存未命中或该 session 没有任何 qresults
                // 根据您的 cacheNestedListToRedisHashes 逻辑，
                // 如果一个 parentItem 没有 childItems，会执行 redis.del(redisHashKey)
                // 所以空对象 {} 意味着没有缓存项，或者确实没有子项。
                return res.status(404).json({ error: `No question results found in cache for session ID ${sessionId}. It might not exist or has no results.` });
            }
        } catch (error) {
            context.logger.error(error, `Error fetching question results for session ID ${sessionId} from cache`);
            return res.status(500).json({ error: 'Failed to fetch question results from cache' });
        }
    });

    // 默认的 "Hello, World!" 路由，可以保留或删除
    // 我将其修改为指向新的、更具体的路由
    router.get('/', (_req, res) => {
        res.send('Practice Session QResults Cache API Endpoint. Use /practice_session_qresults/:sessionId/qresults to get all question results for a session.');
    });
});
