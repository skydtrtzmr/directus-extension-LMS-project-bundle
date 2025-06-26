import { defineEndpoint } from '@directus/extensions-sdk';
import IORedis from 'ioredis'; // 确保你已经安装了 ioredis
import { scanKeysByPattern } from '../utils/redisUtils';
// 假设你的 HookExtensionContext 提供了 services, getSchema, logger
// 如果你需要 ItemsService 来从数据库回源，也需要导入它和相关类型
// import type { EndpointExtensionContext } from '@directus/extensions'; // 更准确的类型
// import { ItemsService } from '@directus/services'; // 如果需要回源

// 在模块顶层或合适的地方初始化 Redis 连接
// 确保这个 Redis 实例与你的 set-paper-cache-hook.ts 中使用的配置一致
const redis = new IORedis(process.env.REDIS!, {
    maxRetriesPerRequest: null,
    // 如果你的缓存和钩子在不同的 Redis DB，这里要指定正确的 db
    // db: 0, // 假设 paper 缓存在 db 0
});

export default defineEndpoint((router, context) => {
    // context 参数包含 services, database, getSchema, logger, env 等
    // const { services, getSchema, logger } = context;

    // GET /your-extension-route/papers (获取所有缓存的 paper ID 列表 - 示例)
    router.get('/papers', async (_req, res) => {
        try {
            // 示例：获取所有 'papers:*' 格式的键
            const paperKeys = await scanKeysByPattern(redis, 'papers:*', context.logger);
            const paperIds = paperKeys.map(key => key.replace('papers:', ''));
            return res.json({ ids: paperIds });
        } catch (error) {
            context.logger.error(error, "Error fetching paper IDs from cache");
            return res.status(500).json({ error: 'Failed to fetch paper IDs from cache' });
        }
    });

    // GET /your-extension-route/papers/:id (根据 ID 获取单个 paper)
    // 【备注】Directus 的 API 扩展是基于 Express.js 的路由构建的，因此完全支持动态路由参数。
    router.get('/papers/:id', async (req, res) => {
        const paperId = req.params.id;

        if (!paperId) {
            return res.status(400).json({ error: 'Paper ID is required' });
        }

        const cacheKey = `papers:${paperId}`;

        try {
            const cachedPaper = await redis.get(cacheKey);

            if (cachedPaper) {
                try {
                    const paperData = JSON.parse(cachedPaper);
                    return res.json(paperData);
                } catch (parseError) {
                    context.logger.error(parseError, `Error parsing cached paper data for ID: ${paperId}`);
                    // 如果解析失败，可能数据已损坏，可以选择删除它
                    await redis.del(cacheKey);
                    return res.status(500).json({ error: 'Failed to parse cached paper data.' });
                }
            } else {
                // 缓存未命中
                // 在这里，你可以选择：
                // 1. 直接返回 404
                // 2. 尝试从数据库回源 (fallback to database)
                //    const { ItemsService } = services;
                //    const papersService = new ItemsService('papers', { schema: await getSchema(), accountability: req.accountability || null });
                //    const paperFromDb = await papersService.readOne(paperId, { fields: comprehensivePaperFields });
                //    if (paperFromDb) {
                //        await redis.set(cacheKey, JSON.stringify(paperFromDb), 'EX', 3600); // 存回缓存
                //        return res.json(paperFromDb);
                //    }
                return res.status(404).json({ error: `Paper with ID ${paperId} not found in cache.` });
            }
        } catch (error) {
            context.logger.error(error, `Error fetching paper with ID ${paperId} from cache`);
            return res.status(500).json({ error: 'Failed to fetch paper from cache' });
        }
    });

    // 默认的 "Hello, World!" 路由，可以保留或删除
    router.get('/', (_req, res) => {
        res.send('Paper Cache API Endpoint. Use /papers/:id to get a paper.');
    });
});
