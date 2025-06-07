import { defineEndpoint } from "@directus/extensions-sdk";
import IORedis from "ioredis";
import type { EndpointExtensionContext } from "@directus/extensions";

const redis = new IORedis(process.env.REDIS!, {
    maxRetriesPerRequest: null,
});
export default defineEndpoint((router, context: EndpointExtensionContext) => {
	
	const { logger } = context;
    router.get("/pop", async (req, res) => {
        // 在执行命令前，检查Redis客户端是否已成功创建并准备就绪
        if (!redis || redis.status !== 'ready') {
            const errorMessage = 'Redis service is unavailable.';
            logger.error(errorMessage);
            // 向客户端返回一个明确的服务不可用错误，而不是让它一直等待
            return res.status(503).send({ error: errorMessage });
        }

        try {
            // 从名为 "student_user_email_list" 的列表左侧弹出一个元素
            const user_email = await redis.lpop("student_user_email_list");

            // 如果列表为空，lpop会返回null
            if (user_email === null) {
                // 返回404 Not Found，表示资源列表为空
                return res.status(404).send({ message: "Student user email list is empty." });
            }

            // 成功获取到email，将其作为JSON对象返回
            // 使用 res.send() 或 res.json() 是更规范的做法
            return res.send({ email: user_email });

        } catch (error) {
            const err = error as Error;
            logger.error(`Failed to pop email from Redis list: ${err.message}`, { error: err });
            // 如果在与Redis交互时发生其他错误，返回500服务器内部错误
            return res.status(500).send({ error: 'An internal error occurred while communicating with Redis.' });
        }
    });
});
