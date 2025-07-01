import { defineHook } from "@directus/extensions-sdk";
import IORedis from "ioredis";
import { setItemsToCache } from "../utils/redisUtils";
import type {
    HookExtensionContext,
    RegisterFunctions,
} from "@directus/extensions";
import type { Query } from "@directus/types";

const redis = new IORedis(process.env.REDIS!, {
    maxRetriesPerRequest: null, // 适用于 Redis 连接本身
});

// 用于获取完整试卷数据的 fields 数组
const comprehensivePaperFields = [
    "id",
    "title",
    "description",
    "total_point_value",
    "total_question_count",
    // 关联的试卷章节 (paper_sections)
    "paper_sections.id",
    "paper_sections.paper_id",
    "paper_sections.sort_in_paper",
    "paper_sections.title",
    "paper_sections.description",
    "paper_sections.points_per_question",
    "paper_sections.question_type",
    "paper_sections.question_mode",
    "paper_sections.total_question_points",
    "paper_sections.questions.id",
    "paper_sections.questions.sort_in_section",
    "paper_sections.questions.paper_sections_id",
    // 章节中的问题 (通过 paper_sections_questions 关联)
    "paper_sections.questions.questions_id.id",
    "paper_sections.questions.questions_id.stem",
    "paper_sections.questions.questions_id.analysis",
    // 题目类型，在详细题型里面已经有了。但是目前前端代码还是从这里取的。
    "paper_sections.questions.questions_id.type",
    // "paper_sections.questions.questions_id.analysis", 
    // 题目解析内容较多，不要放在一起获取。
    // 可以改成和question_result一样，另外按需获取。
    "paper_sections.questions.questions_id.q_mc_single.id",
    // "paper_sections.questions.questions_id.q_mc_single.stem",
    "paper_sections.questions.questions_id.q_mc_single.option_a",
    "paper_sections.questions.questions_id.q_mc_single.option_b",
    "paper_sections.questions.questions_id.q_mc_single.option_c",
    "paper_sections.questions.questions_id.q_mc_single.option_d",
    "paper_sections.questions.questions_id.q_mc_single.option_e",
    "paper_sections.questions.questions_id.q_mc_single.option_f",
    "paper_sections.questions.questions_id.q_mc_single.correct_option",
    "paper_sections.questions.questions_id.q_mc_single.analysis",
    "paper_sections.questions.questions_id.q_mc_multi.id",
    // "paper_sections.questions.questions_id.q_mc_multi.stem",
    "paper_sections.questions.questions_id.q_mc_multi.option_a",
    "paper_sections.questions.questions_id.q_mc_multi.option_b",
    "paper_sections.questions.questions_id.q_mc_multi.option_c",
    "paper_sections.questions.questions_id.q_mc_multi.option_d",
    "paper_sections.questions.questions_id.q_mc_multi.option_e",
    "paper_sections.questions.questions_id.q_mc_multi.option_f",
    "paper_sections.questions.questions_id.q_mc_multi.correct_options",
    "paper_sections.questions.questions_id.q_mc_multi.analysis",
    "paper_sections.questions.questions_id.q_mc_binary.id",
    // "paper_sections.questions.questions_id.q_mc_binary.stem",
    "paper_sections.questions.questions_id.q_mc_binary.option_a",
    "paper_sections.questions.questions_id.q_mc_binary.option_b",
    "paper_sections.questions.questions_id.q_mc_binary.correct_option",
    "paper_sections.questions.questions_id.q_mc_binary.analysis",
    "paper_sections.questions.questions_id.q_mc_flexible.id",
    // "paper_sections.questions.questions_id.q_mc_flexible.stem",
    "paper_sections.questions.questions_id.q_mc_flexible.option_a",
    "paper_sections.questions.questions_id.q_mc_flexible.option_b",
    "paper_sections.questions.questions_id.q_mc_flexible.option_c",
    "paper_sections.questions.questions_id.q_mc_flexible.option_d",
    "paper_sections.questions.questions_id.q_mc_flexible.option_e",
    "paper_sections.questions.questions_id.q_mc_flexible.option_f",
    "paper_sections.questions.questions_id.q_mc_flexible.correct_options",
    "paper_sections.questions.questions_id.q_mc_flexible.analysis",
    "paper_sections.questions.questions_id.question_group.id",
    "paper_sections.questions.questions_id.question_group.shared_stem",
    "paper_sections.questions.questions_id.sort_in_group",
    // "paper_sections.questions.questions_id.correct_ans_select_radio",
    // "paper_sections.questions.questions_id.correct_ans_select_multiple_checkbox",
    // "paper_sections.questions.paper_sections_id",
    // 章节中的题组 (通过 paper_sections_question_groups 关联)
    "paper_sections.question_groups",
    "paper_sections.question_groups.id",
    "paper_sections.question_groups.question_groups_id.id", // 这是 question_groups 集合中项的 ID
    "paper_sections.question_groups.question_groups_id.questions", // 题组中的问题id列表
    "paper_sections.question_groups.question_groups_id.shared_stem",
    // 题组中的问题（这边可以优化 TODO）
    "paper_sections.question_groups.sort_in_section", // 题组在章节内的排序
    "paper_sections.question_groups.paper_sections_id",
    // "paper_sections.question_groups.group_question_ids"
];

export default defineHook(
    (
        { filter, action, init, schedule }: RegisterFunctions,
        hookContext: HookExtensionContext
    ) => {
        const { services, getSchema, logger } = hookContext;
        const { ItemsService } = services;

        // 共享的函数，用于获取并缓存试卷数据
        const fetchAndCachePapers = async () => {
            logger.info("Fetching and caching papers started...");
            try {
                const currentSchema = await getSchema(); // 获取最新的 schema
                // 使用管理员权限 (省略 accountability) 来获取所有 papers
                const papersService = new ItemsService("papers", {
                    schema: currentSchema,
                    // accountability: null, // 如果只需要公共数据，则使用 null
                });

                // 调用你的 redisUtils 中的函数来处理缓存
                // 注意：setItemsToCache 应该是一个 async 函数，这里使用 await
                await setItemsToCache(
                    redis,
                    "papers", // Redis 命名空间，键将是 "papers:id"
                    async () =>
                        await papersService.readByQuery({
                            fields: comprehensivePaperFields,
                            limit: -1, // 获取所有项目
                        } as Query),
                    "id", // 对象中用作唯一ID的字段名
                    3600 // 缓存时间 (TTL)，例如1小时 (3600秒)。你可以根据需要调整。
                );
                logger.info(
                    "Fetching and caching papers completed successfully."
                );
            } catch (error) {
                logger.error(
                    error,
                    "Error occurred during fetchAndCachePapers:"
                );
            }
        };

        // 定时任务，例如每小时执行一次 (你可以调整 cron 表达式)
        // '0 * * * *' 表示每小时的第0分钟执行
        // '*/1 * * * *' 表示每1分钟执行一次，对于全量刷新可能过于频繁，请谨慎设置
        schedule("*/30 * * * *", async () => {
            // 例如，改为每15分钟
            logger.info("Scheduled paper cache refresh triggered.");
            await fetchAndCachePapers();
        });

        // 应用初始化时预热缓存 (例如 'app.after' 表示 Directus 应用完全加载后)
        // 参考文档: https://docs.directus.io/guides/extensions/api-extensions/hooks.html#init-events
        init("app.after", async ({ app }) => {
            // app 参数可用，但这里我们不需要它
            logger.info(
                "Initial paper cache warming triggered (on app.after)."
            );
            await fetchAndCachePapers();
        });

        // 你可以根据需要添加其他的 filter 或 action 钩子
        // 例如，当 papers 集合中的数据发生变化时，精确更新或删除相关缓存
        action("papers.items.create", async (meta, context) => {
            // meta.key or meta.keys 包含被创建/更新/删除的项的ID
            // context 包含 services, getSchema 等
            logger.info(
                `Paper created/updated/deleted (event: ${
                    meta.event
                }). Invalidating/updating cache for key(s): ${
                    meta.key || meta.keys
                }`
            );
            // 这里可以调用一个更精确的函数来更新单个 paper 的缓存，或者简单地重新运行全量缓存
            await fetchAndCachePapers(); // 简单起见，重新获取全部。或者实现一个 updateSinglePaperInCache(meta.key)
        });
        action("papers.items.update", async (meta, context) => {
            logger.info(
                `Paper created/updated/deleted (event: ${
                    meta.event
                }). Invalidating/updating cache for key(s): ${
                    meta.key || meta.keys
                }`
            );
            await fetchAndCachePapers();
        });
        action("papers.items.delete", async (meta, context) => {
            logger.info(
                `Paper created/updated/deleted (event: ${
                    meta.event
                }). Invalidating/updating cache for key(s): ${
                    meta.key || meta.keys
                }`
            );
            // 对于删除操作，你可能需要从 Redis 中明确删除对应的键
            // await deleteItemsFromCache(redis, "papers", meta.keys);
            // 或者，如果你的 setItemsToCache 在获取不到数据时会清除旧缓存，那也可以接受
            await fetchAndCachePapers(); // 重新获取，间接删除了不存在的
        });

        // 示例 filter (如果你需要)
        // filter('items.create', (payload, meta, context) => {
        //     logger.info('About to create item in papers collection:', payload);
        //     return payload; // 必须返回 payload
        // });
    }
);
