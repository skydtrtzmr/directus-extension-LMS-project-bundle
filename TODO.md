# 需要注意的问题

## API缓存写入优化建议

### 当前设计分析
- 现有模式：立即写入缓存 → 加入队列异步更新数据库
- 总体评价：合理，适合考试系统高并发场景
- 优势：用户体验好、减少数据库压力、系统响应快

### 需要改进的问题

#### 1. 数据一致性风险
**问题：** 缓存成功但队列失败，导致缓存有数据而数据库没有
```typescript
// 当前可能的问题
await redis.hmset(key, data);        // ✅ 成功
await queue.add(jobName, data);      // ❌ 失败 (网络/Redis问题)
// 结果：数据不一致
```
**建议：** 增加回滚机制

```typescript
let cacheWritten = false;
try {
    // 1. 写入缓存
    await redis.hmset(childRedisKey, itemToCache);
    await redis.expire(childRedisKey, DEFAULT_CACHE_TTL);
    cacheWritten = true;
    
    // 2. 加入队列
    await answerQueue.add("process-question-answer", data, {
        attempts: 5,
        backoff: { type: "exponential", delay: 2000 }
    });
    
} catch (error) {
    // 如果队列失败且缓存已写入，考虑回滚
    if (cacheWritten && error.message.includes('queue')) {
        try {
            await redis.del(childRedisKey);
            logger.info(`Rolled back cache for key: ${childRedisKey} due to queue failure`);
        } catch (rollbackError) {
            logger.error(`Failed to rollback cache: ${rollbackError}`);
        }
    }
    throw error;
}
```


#### 2. 缓存过期与数据库同步问题
**问题：** 如果数据库写入失败，缓存过期后数据丢失
**建议：** 增加缓存过期检查机制，确保重要数据不丢失

#### 3. 队列处理失败的补偿机制
**问题：** 重试5次后仍失败的数据如何处理
**建议：** 增加死信队列处理机制

### 具体优化措施

#### 1. 分级处理策略
```typescript
// 根据数据重要性采用不同策略
if (isExamAnswer) {
    // 考试答案：必须保证数据安全
    await ensureDataSafety(data);
} else if (isPracticeAnswer) {
    // 练习答案：可以接受一定风险
    await currentStrategy(data);
}
```

#### 2. 增加数据校验
在API写入前验证关键字段完整性

#### 3. 监控和告警
- 监控缓存-数据库同步状态
- 队列积压告警
- 失败率监控

#### 4. 事务性保证
考虑先队列后缓存的执行顺序，减少不一致风险

### 实施优先级
1. **高优先级：** 数据校验、死信队列处理
2. **中优先级：** 分级处理策略、监控告警
3. **低优先级：** 执行顺序调整（需要充分测试）