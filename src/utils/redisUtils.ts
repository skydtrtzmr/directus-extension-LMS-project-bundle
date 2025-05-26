// server/utils/redisUtils.ts

// 这里存放的是操作redis的工具函数

import type { Redis } from "ioredis";

// [2025-05-23] 新增函数：根据fetchFunction获取到的数据（一个对象列表），将每个对象作为独立的键值对存入Redis。
// 键的格式为 namespace:id，值为对象的JSON字符串。
export async function setItemsToCache(
    redis: Redis, // 传入一个ioredis实例
    namespace: string, // Redis键的命名空间，例如 "paper"
    fetchFunction: () => Promise<any[]>, // 获取数据的异步函数，返回一个对象数组
    idField: string = "id", // 对象中用作唯一ID的字段名，默认为 "id"
    ttl: number = 3600 // 缓存的过期时间（秒），默认为 1 小时
): Promise<void> {
    const items = await fetchFunction();

    if (!items || items.length === 0) {
        console.log(`[Cache] Namespace '${namespace}': No items fetched. Nothing to cache.`);
        return;
    }

    console.log(`[Cache] Namespace '${namespace}': Fetched ${items.length} items. Starting to cache...`);

    // 使用 pipeline 批量处理命令，提高效率
    const pipeline = redis.pipeline();
    let itemsPreparedForCache = 0;

    for (const item of items) {
        const itemId = item[idField];
        if (itemId === undefined || itemId === null || itemId.toString().trim() === "") {
            console.warn(`[Cache] Namespace '${namespace}': Item is missing ID field '${idField}' or ID is null/empty. Skipping. Item (first 100 chars):`, JSON.stringify(item).substring(0, 100) + "...");
            continue;
        }
        const key = `${namespace}:${itemId.toString()}`;
        try {
            pipeline.set(key, JSON.stringify(item), "EX", ttl);
            itemsPreparedForCache++;
        } catch (error) {
            // 这个catch理论上不太可能捕捉到错误，因为pipeline.set只是排队命令，不立即执行
            // 但为了以防万一，比如JSON.stringify本身失败（不太可能对于普通对象）
            console.error(`[Cache] Namespace '${namespace}': Error preparing to cache item with key '${key}'. Item (first 100 chars):`, JSON.stringify(item).substring(0, 100) + "...", "Error:", error);
        }
    }

    if (itemsPreparedForCache === 0) {
        if (items.length > 0) {
            console.warn(`[Cache] Namespace '${namespace}': No items were suitable for caching out of ${items.length} fetched items. Check ID field ('${idField}') issues or other pre-caching errors.`);
        }
        // 如果 items.length === 0, 此情况已在函数开头处理
        return;
    }
    
    console.log(`[Cache] Namespace '${namespace}': ${itemsPreparedForCache} items prepared for pipeline execution.`);

    try {
        const results = await pipeline.exec();
        // pipeline.exec() 返回一个数组，每个元素是对应命令的执行结果
        // 例如：[[null, "OK"], [null, "OK"]] for two successful set commands
        // result[0] 是错误对象 (Error | null)，result[1] 是命令的返回值
        
        let successfulOperations = 0;
        let failedOperations = 0;

        if (results) {
            for (let i = 0; i < results.length; i++) {
                const result = results[i];
                if (result && result[0]) { // result[0] is the error object
                    failedOperations++;
                    console.error(`[Cache] Namespace '${namespace}': Error in pipeline execution for an item. Error:`, result[0]);
                } else {
                    successfulOperations++;
                }
            }
        }

        if (failedOperations > 0) {
            console.error(`[Cache] Namespace '${namespace}': Finished caching. ${successfulOperations} items cached successfully, ${failedOperations} items failed during pipeline execution.`);
        } else {
            console.log(`[Cache] Namespace '${namespace}': Successfully cached ${successfulOperations} items.`);
        }

    } catch (error) {
        // 这个catch捕捉的是pipeline.exec()本身的执行错误，例如连接问题
        console.error(`[Cache] Namespace '${namespace}': Critical error executing Redis pipeline. ${itemsPreparedForCache} items were attempted. Error:`, error);
    }
}
