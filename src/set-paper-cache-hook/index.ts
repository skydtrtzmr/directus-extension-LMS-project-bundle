import { defineHook } from "@directus/extensions-sdk";
import IORedis from "ioredis";
import { setItemsToCache } from "../utils/redisUtils";
import type {
    HookExtensionContext,
    RegisterFunctions,
} from "@directus/extensions";
import type {
    Accountability,
    Item as AnyItem,
    Query,
    SchemaOverview,
} from "@directus/types";

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
    "paper_sections.questions",
    "paper_sections.questions.id",
    "paper_sections.questions.sort_in_section",
    "paper_sections.questions.paper_sections_id",
    // 章节中的问题 (通过 paper_sections_questions 关联)
    "paper_sections.questions.questions_id.id",
    "paper_sections.questions.questions_id.stem",
    "paper_sections.questions.questions_id.type",
    "paper_sections.questions.questions_id.analysis",
    "paper_sections.questions.questions_id.q_mc_single.*",
    "paper_sections.questions.questions_id.q_mc_multi.*",
    "paper_sections.questions.questions_id.q_mc_binary.*",
    "paper_sections.questions.questions_id.q_mc_flexible.*",
    "paper_sections.questions.questions_id.question_group.id",
    "paper_sections.questions.questions_id.question_group.shared_stem",
    "paper_sections.questions.questions_id.sort_in_group",
    "paper_sections.questions.questions_id.correct_ans_select_radio",
    "paper_sections.questions.questions_id.correct_ans_select_multiple_checkbox",
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
        { services, database, getSchema, logger }: HookExtensionContext
    ) => {
        const { ItemsService } = services;

        // 共享的函数，用于获取试卷数据
        const fetchPaper = async (payload: any, meta: any, context: any) => {
            console.log("fetchPaper 执行中");

            const { accountability, schema } = context;
            console.log("context", context);

            const serviceOptions = { schema, accountability };

            // 创建必要的服务
            const papersService = new ItemsService("papers", serviceOptions);

            setItemsToCache(
                redis,
                "papers_full_data", // 新的缓存键
                async () =>
                    await papersService.readByQuery({
                        fields: comprehensivePaperFields,
                        limit: -1,
                    } as Query),
                "id", // 对象中用作唯一ID的字段名
                60 // 缓存时间，例如1小时 (3600秒)
            );
        };

        filter("items.create", () => {
            console.log("Creating Item!");
        });

        schedule("*/1 * * * *", () => {
            console.log("1 minutes have passed.");
            fetchPaper(null, null, context);
            console.log("fetchPaper 执行完毕");
        });

        action("items.create", () => {
            console.log("Item created!");
        });
    }
);
