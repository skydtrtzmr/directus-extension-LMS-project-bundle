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

// 通用的设置hash缓存的方法，将列表中的每个对象作为独立的键值对存入Redis。
export async function setHashCache(
    redis: Redis, // 传入一个ioredis实例
    key: string,
    fetchFunction: () => Promise<any[]>, // 注意这里一定返回的是个数组，因为是 Hash 列表
    ttl: number = 3600
): Promise<void> {
    const data = await fetchFunction();
    const pipeline = redis.pipeline();
    let itemsPrepared = 0;
    for (const item of data) {
        if (item && typeof item.id !== 'undefined') {
            pipeline.hset(key, item.id.toString(), JSON.stringify(item));
            itemsPrepared++;
        } else {
            console.warn(`[setHashCache] Item for key '${key}' is missing 'id' field or item is null/undefined. Skipping item:`, item);
        }
    }

    if (itemsPrepared > 0) {
        pipeline.expire(key, ttl);
        try {
            await pipeline.exec();
            console.log(`[setHashCache] Successfully cached ${itemsPrepared} items into Hash '${key}' with TTL ${ttl}s.`);
        } catch (error) {
            console.error(`[setHashCache] Error executing pipeline for Hash '${key}'. Items attempted: ${itemsPrepared}. Error:`, error);
        }
    } else {
        console.log(`[setHashCache] No items prepared for Hash '${key}'. Cache not set/updated.`);
        // Optionally, delete the key if no items are to be cached, to clear old data.
        // await redis.del(key);
    }
}

// NEW FUNCTION for two-level nested caching
/**
 * Caches a two-level nested structure into multiple Redis Hashes.
 * Fetches a list of parent items. For each parent, it fetches its associated child items
 * and stores them in a dedicated Redis Hash.
 *
 * @param redis - The IORedis client instance.
 * @param parentNamespace - Namespace prefix for the Redis Hash keys (e.g., "practice_session_qresults").
 * @param fetchParentItems - Async function to fetch the list of parent items.
 * @param parentIdField - The field name in parent items used to form the unique part of the Redis Hash key.
 * @param fetchChildItemsForParent - Async function that takes a parent item and returns its list of child items.
 * @param childIdField - The field name in child items used as the field key within the Redis Hash.
 * @param ttl - Time-to-live in seconds for each individual Redis Hash.
 */
export async function cacheNestedListToRedisHashes<
    TParentItem extends { [key: string]: any },
    TChildItem extends { [key: string]: any }
>(
    redis: Redis,
    parentNamespace: string,
    fetchParentItems: () => Promise<TParentItem[]>,
    parentIdField: keyof TParentItem | string, // Allows string for dynamic access
    fetchChildItemsForParent: (parentItem: TParentItem) => Promise<TChildItem[]>,
    childIdField: keyof TChildItem | string, // Allows string for dynamic access
    ttl: number = 3600
): Promise<void> {
    console.log(`[NestedCache] Starting process for namespace '${parentNamespace}'.`);
    let parentItems: TParentItem[];
    try {
        parentItems = await fetchParentItems();
        if (!parentItems || parentItems.length === 0) {
            console.log(`[NestedCache] Namespace '${parentNamespace}': No parent items fetched. Exiting.`);
            return;
        }
        console.log(`[NestedCache] Namespace '${parentNamespace}': Fetched ${parentItems.length} parent items.`);
    } catch (error) {
        console.error(`[NestedCache] Namespace '${parentNamespace}': Failed to fetch parent items. Error:`, error);
        return;
    }

    for (const parentItem of parentItems) {
        const parentIdValue = parentItem[parentIdField as string];
        if (parentIdValue === undefined || parentIdValue === null || parentIdValue.toString().trim() === "") {
            console.warn(`[NestedCache] Namespace '${parentNamespace}': Parent item is missing ID field '${parentIdField as string}' or ID is null/empty. Skipping parent:`, parentItem);
            continue;
        }

        const redisHashKey = `${parentNamespace}:${parentIdValue.toString()}`;
        console.log(`[NestedCache] Processing parent. Hash key: '${redisHashKey}'.`);

        try {
            const childItems = await fetchChildItemsForParent(parentItem);

            if (!childItems || childItems.length === 0) {
                console.log(`[NestedCache] Hash Key '${redisHashKey}': No child items fetched. Clearing existing hash (if any).`);
                // If no children, we might want to delete any existing hash to ensure freshness
                await redis.del(redisHashKey); // Clear out old data for this specific hash
                continue; // Move to the next parent item
            }

            console.log(`[NestedCache] Hash Key '${redisHashKey}': Fetched ${childItems.length} child items. Preparing pipeline.`);
            const pipeline = redis.pipeline();
            let itemsPreparedForThisHash = 0;

            // Optional: Delete the old hash key before populating, to ensure a clean slate for these children
            // pipeline.del(redisHashKey); 

            for (const childItem of childItems) {
                const childIdValue = childItem[childIdField as string];
                if (childIdValue === undefined || childIdValue === null || childIdValue.toString().trim() === "") {
                    console.warn(`[NestedCache] Hash Key '${redisHashKey}': Child item is missing ID field '${childIdField as string}' or ID is null/empty. Skipping child:`, JSON.stringify(childItem).substring(0,100) + "...");
                    continue;
                }
                pipeline.hset(redisHashKey, childIdValue.toString(), JSON.stringify(childItem));
                itemsPreparedForThisHash++;
            }

            if (itemsPreparedForThisHash > 0) {
                pipeline.expire(redisHashKey, ttl);
                await pipeline.exec();
                console.log(`[NestedCache] Hash Key '${redisHashKey}': Successfully cached ${itemsPreparedForThisHash} child items with TTL ${ttl}s.`);
            } else {
                 console.log(`[NestedCache] Hash Key '${redisHashKey}': No child items were prepared for caching (all might have been skipped).`);
                 // If we didn't add a del to the pipeline earlier, and no items were prepared, 
                 // we might still want to ensure an empty hash or delete it.
                 // For simplicity here, if no items are prepared, no pipeline.exec() is called for HSETs.
                 // Consider if an empty hash should explicitly be set or key deleted if all children are invalid.
                 // If pipeline.del(redisHashKey) was the first command in pipeline, it would have executed if itemsPrepared >0.
                 // If 0 items, we might want redis.del(redisHashKey) explicitly if fetch was successful but yielded no valid children.
            }

        } catch (error) {
            console.error(`[NestedCache] Hash Key '${redisHashKey}': Failed to fetch or cache child items. Error:`, error);
            // Continue to the next parent item
        }
    }
    console.log(`[NestedCache] Finished processing for namespace '${parentNamespace}'.`);
}

// 更新列表缓存。
export async function updateListCache(
    redis: Redis,
    key: string, // 在redis中的表名
    fetchFunction: () => Promise<any[]>, // 注意这里一定返回的是个数组，因为是列表
    field: string, // 需要存入列表的字段
    ttl: number = 3600
): Promise<void> {
    const data = await fetchFunction();
    const resultArray: string[] = data.map((item) => item[field]);

    if (resultArray.length === 0) {
        // 如果没有获取到数据，可以选择清空旧的列表或者什么都不做
        // 在这里我们选择清空，以保证数据的一致性
        console.log(`[updateListCache] No data fetched for key '${key}'. Clearing existing list.`);
        await redis.del(key);
        return;
    }

    console.log(`[updateListCache] Fetched ${resultArray.length} items for key '${key}'. Updating cache...`);

    // 使用pipeline来确保原子性操作：先删除旧列表，再添加新列表
    const pipeline = redis.pipeline();
    // 1. 删除旧的列表
    pipeline.del(key);
    // 2. 将所有新元素推入列表
    pipeline.rpush(key, ...resultArray);
    // 3. 设置过期时间
    pipeline.expire(key, ttl);

    try {
        await pipeline.exec();
        console.log(`[updateListCache] Successfully updated list '${key}' with ${resultArray.length} items and TTL ${ttl}s.`);
    } catch (error) {
        console.error(`[updateListCache] Error executing pipeline for list '${key}'.`, error);
    }
}

// [2025-05-26] 新增函数：将嵌套数据列表的子项缓存为独立的Redis Hash
// 每个子项都拥有自己的Redis键，格式为 parentNamespace:parentId:childNamespace:childId
// 这样做的好处是，更新单个子项时，只需要修改对应的Hash，而不需要重写整个父项的子项列表
export async function cacheNestedObjectsToIndividualRedisHashes<
    TParentItem extends { [key: string]: any },
    TChildItem extends { [key: string]: any }
>(
    redis: Redis,
    parentNamespace: string, // 父项的命名空间, e.g., "practice_session"
    parentItems: TParentItem[], // 父项列表
    parentIdField: keyof TParentItem | string, // 父项ID字段名
    childListName: keyof TParentItem | string, // 父项中子项列表的字段名
    childNamespace: string, // 子项的命名空间, e.g., "qresult" 
    childIdField: keyof TChildItem | string, // 子项ID字段名
    ttlSeconds: number = 3600, // 每个子项Hash的过期时间 (秒)
): Promise<void> {
    console.log(`[IndividualNestedCache] Starting process for parent namespace '${parentNamespace}', child namespace '${childNamespace}'. Caching ${parentItems.length} parent items.`);

    for (const parentItem of parentItems) {
        const parentId = parentItem[parentIdField as string];
        if (parentId === undefined || parentId === null || parentId.toString().trim() === "") {
            console.warn(`[IndividualNestedCache] Parent item in namespace '${parentNamespace}' is missing ID field '${parentIdField as string}' or ID is null/empty. Skipping. Parent:`, parentItem);
            continue;
        }

        const childItems = parentItem[childListName as string] as TChildItem[];

        // 1. 清理该父项之前的所有子项缓存 (如果存在)
        const oldChildKeysPattern = `${parentNamespace}:${parentId}:${childNamespace}:*`;
        try {
            const keysToDelete = await redis.keys(oldChildKeysPattern);
            if (keysToDelete && keysToDelete.length > 0) {
                console.log(`[IndividualNestedCache] Parent '${parentId}': Found ${keysToDelete.length} old child keys matching '${oldChildKeysPattern}'. Deleting...`);
                await redis.del(keysToDelete); // 使用 redis.del([...keysToDelete]) 如果 keys 是数组
            }
        } catch (error) {
            console.error(`[IndividualNestedCache] Parent '${parentId}': Error searching or deleting old child keys matching '${oldChildKeysPattern}'. Error:`, error);
            // 根据策略决定是否继续，这里选择继续处理当前父项的新子项
        }

        if (!childItems || childItems.length === 0) {
            console.log(`[IndividualNestedCache] Parent '${parentId}' in namespace '${parentNamespace}': No child items found in list '${childListName as string}'. Any old children were cleared.`);
            continue;
        }

        console.log(`[IndividualNestedCache] Parent '${parentId}': Processing ${childItems.length} child items from list '${childListName as string}'.`);
        const pipeline = redis.pipeline();
        let childrenProcessedCount = 0;

        for (const childItem of childItems) {
            const childId = childItem[childIdField as string];
            if (childId === undefined || childId === null || childId.toString().trim() === "") {
                console.warn(`[IndividualNestedCache] Parent '${parentId}', Child item in list '${childListName as string}' is missing ID field '${childIdField as string}' or ID is null/empty. Skipping child:`, childItem);
                continue;
            }

            const childRedisKey = `${parentNamespace}:${parentId}:${childNamespace}:${childId.toString()}`;
            
            // 将子对象转换为 [field, value, field, value, ...] 的数组或 Record<string, string>
            // Redis HMSET/HSET 命令要求值是 string | number | Buffer.
            // 我们将所有值转换为字符串以保持一致性。
            const childItemMap: { [key: string]: string } = {};
            for (const key in childItem) {
                if (Object.prototype.hasOwnProperty.call(childItem, key)) {
                    const value = childItem[key];
                    if (value === null || value === undefined) {
                        childItemMap[key] = "";
                    } else if (typeof value === 'object') { // Covers arrays and plain objects
                        childItemMap[key] = JSON.stringify(value);
                    } else { // Covers string, number, boolean, bigint, symbol
                        childItemMap[key] = String(value);
                    }
                }
            }

            if (Object.keys(childItemMap).length > 0) {
                pipeline.hmset(childRedisKey, childItemMap);
                pipeline.expire(childRedisKey, ttlSeconds);
                childrenProcessedCount++;
            } else {
                console.warn(`[IndividualNestedCache] Parent '${parentId}', Child ID '${childId}': Resulting map for HASH was empty. Skipping HMSET for key '${childRedisKey}'. Child item:`, childItem);
            }
        }

        if (childrenProcessedCount > 0) {
            try {
                const results = await pipeline.exec();
                // console.log(`[IndividualNestedCache] Parent '${parentId}': Pipeline executed for ${childrenProcessedCount} children. Results count: ${results ? results.length : 'N/A'}.`);
                // 可选：检查 pipeline 执行结果中的错误
                if (results) {
                    results.forEach((result, index) => {
                        if (result && result[0]) { // result[0] 是错误对象
                            console.error(`[IndividualNestedCache] Parent '${parentId}': Error in pipeline command for child (index ${Math.floor(index / 2)}): `, result[0]);
                        }
                    });
                }
            } catch (error) {
                console.error(`[IndividualNestedCache] Parent '${parentId}': Critical error executing Redis pipeline for ${childrenProcessedCount} children. Error:`, error);
            }
        } else {
            console.log(`[IndividualNestedCache] Parent '${parentId}': No children were suitable for caching after filtering.`);
        }
    }
    console.log(`[IndividualNestedCache] Finished processing all parent items for parent namespace '${parentNamespace}'.`);
}

// 辅助函数：递归扁平化对象，键名用指定分隔符连接
// 所有值最终都会转换为字符串，以便存入 Redis Hash
function flattenObjectRecursive(
    obj: any,
    parentKey: string = '',
    separator: string = '__', // 使用双下划线分割，而不是短横；短横容易引起麻烦
    result: Record<string, string> = {} // 初始化 result 对象
): Record<string, string> {
    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            const newKey = parentKey ? parentKey + separator + key : key;
            const value = obj[key];

            if (value === null || value === undefined) {
                result[newKey] = String(value); // 'null' 或 'undefined' 字符串
            } else if (typeof value === 'object' && !Array.isArray(value)) {
                // 是对象但不是数组，递归
                flattenObjectRecursive(value, newKey, separator, result);
            } else if (Array.isArray(value)) {
                // 数组转换为 JSON 字符串
                result[newKey] = JSON.stringify(value);
            } else {
                // 基本类型 (string, number, boolean, BigInt, Symbol)
                result[newKey] = String(value);
            }
        }
    }
    return result;
}

/**
 * 将给定的对象扁平化处理后，存入 Redis Hash。
 * 嵌套键将使用 '__' 分隔符连接。例如：{ a: { b: 1 } } -> Hash Field 'a__b': '1'
 * 数组值将被 JSON.stringify。
 * @param redis - IORedis 客户端实例。
 * @param namespace - Redis键的命名空间, e.g., "practice_session"
 * @param data - 要扁平化并存入的对象
 * @param idField - 对象中用作唯一ID的字段名
 * @param ttlSeconds - Hash的过期时间（秒）
 */
export async function setFlattenedObjectToHash(
    redis: Redis,
    namespace: string, // Redis键的命名空间, e.g., "practice_session"
    data: Record<string, any>, // 要扁平化并存入的对象
    idField: string, // 对象中用作唯一ID的字段名
    ttlSeconds: number = 3600 // Hash的过期时间（秒）
): Promise<void> {
    if (!data || Object.keys(data).length === 0) {
        console.log(`[FlattenedCache] Namespace '${namespace}': Input data is empty. Nothing to cache.`);
        return;
    }

    const idValue = data[idField];
    if (idValue === undefined || idValue === null || String(idValue).trim() === "") {
        console.warn(`[FlattenedCache] Namespace '${namespace}': Item is missing ID field '${idField}' or ID is null/empty. Skipping. Data (first 100 chars):`, JSON.stringify(data).substring(0, 100) + "...");
        return;
    }

    const hashKey = `${namespace}:${String(idValue)}`;
    console.log(`[FlattenedCache] Hash key '${hashKey}': Starting to flatten and cache data.`);

    const flattenedData: Record<string, string> = flattenObjectRecursive(data);

    if (Object.keys(flattenedData).length === 0) {
        console.log(`[FlattenedCache] Hash key '${hashKey}': Data resulted in an empty flattened map. Nothing to cache.`);
        // await redis.del(hashKey); // Consider if old key should be deleted
        return;
    }

    const pipeline = redis.pipeline();
    pipeline.hmset(hashKey, flattenedData);
    pipeline.expire(hashKey, ttlSeconds);

    try {
        await pipeline.exec();
        console.log(`[FlattenedCache] Hash key '${hashKey}': Successfully cached ${Object.keys(flattenedData).length} flattened fields with TTL ${ttlSeconds}s.`);
    } catch (error) {
        console.error(`[FlattenedCache] Hash key '${hashKey}': Error executing Redis pipeline. Error:`, error);
    }
}

/**
 * Deletes all keys matching a given pattern using SCAN to avoid blocking Redis.
 * This is safer for production environments than using the KEYS command.
 *
 * @param redis The IORedis client instance.
 * @param pattern The pattern to match keys against (e.g., "namespace:*").
 * @param logger Optional logger to log information.
 */
export async function deleteKeysByPattern(
    redis: Redis,
    pattern: string,
    logger?: { info: (msg: string) => void; error: (err: any, msg?: string) => void }
): Promise<void> {
    const log = logger || { info: console.log, error: (e, m) => console.error(m, e) };
    log.info(`[RedisUtils] Starting to delete keys matching pattern: ${pattern}`);
    let cursor = '0';
    let keysDeletedCount = 0;
    try {
        do {
            const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
            cursor = nextCursor;
            if (keys.length > 0) {
                keysDeletedCount += await redis.del(keys);
            }
        } while (cursor !== '0');
        log.info(`[RedisUtils] Finished deleting keys for pattern "${pattern}". Total keys deleted: ${keysDeletedCount}`);
    } catch (error) {
        log.error(error, `[RedisUtils] Error while deleting keys with pattern "${pattern}"`);
    }
}