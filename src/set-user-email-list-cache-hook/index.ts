import { defineHook } from "@directus/extensions-sdk";
import IORedis from "ioredis";
import type {
    HookExtensionContext,
    RegisterFunctions,
} from "@directus/extensions";
import { updateListCache } from "../utils/redisUtils";

const redis = new IORedis(process.env.REDIS!, {
    maxRetriesPerRequest: null, // 适用于 Redis 连接本身
});

export default defineHook(
    (
        { init, schedule }: RegisterFunctions,
        hookContext: HookExtensionContext
    ) => {
        const { services, getSchema, logger } = hookContext;
        const { UsersService } = services;

        const cronSchedule =
            process.env.USER_PS_CACHE_CRON_SCHEDULE || "*/30 * * * *";
        const INDEX_PREFIX = "user_email"; // Namespace for these keys

        const fetchAndCacheUserEmailList = async () => {
            const directusUserService = new UsersService({
                schema: await getSchema(),
                accountability: { admin: true },
            });
            updateListCache(
                redis,
                "student_user_email_list",
                async () =>
                    await directusUserService.readByQuery({
                        fields: ["email"],
                        sort: ["email"], // 注意，sort一定是列表，否则会报错。
                        filter: {
                            role: {
                                name: {
                                    _eq: "学生",
                                },
                            },
                        },
                        limit: -1,
                    }),
                "email",
                3600
            );
        };

        schedule(cronSchedule, async () => {
            logger.info(
                `[${INDEX_PREFIX}] Scheduled user email list cache refresh triggered by cron (${cronSchedule}).`
            );
            await fetchAndCacheUserEmailList();
        });

        // Run on application initialization (after app is ready)
        init("app.after", async () => {
            logger.info(
                `[${INDEX_PREFIX}] Initial user email list cache warming triggered.`
            );
            await fetchAndCacheUserEmailList();
        });
    }
);
