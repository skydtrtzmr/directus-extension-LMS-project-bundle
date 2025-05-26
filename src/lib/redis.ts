// server/lib/redis.ts
import Redis from 'ioredis';

// 配置 ioredis 客户端


console.log("连接 Redis 成功，创建redis实例");
// ioredis会给一个实例分配一个连接池，其中每个连接池中包含多个连接。

const redis = new Redis(process.env.REDIS!, {
    maxRetriesPerRequest: null, // 适用于 Redis 连接本身
    enableAutoPipelining: true, // 自动管道化，提高性能
});

export default redis;