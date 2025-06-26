import { ref, computed } from 'vue';
import { useItems } from '@directus/extensions-sdk';

// 默认主题色（如果系统没有设置的话）
const DEFAULT_THEME_COLOR = '#3399FF';
export function useThemeColor() {
    const collectionRef = ref('directus_settings');
    const settings = ref<any>(null);
    const loading = ref(false);
    const error = ref<string | null>(null);

    const query = {
        fields: ref(['project_color']),
        limit: ref(1),
        sort: ref(null),
        search: ref(null),
        filter: ref(null),
        page: ref(1),
    };

    console.log('[useThemeColor] 初始化 useItems，查询参数:', {
        collection: collectionRef.value,
        fields: query.fields.value,
        limit: query.limit.value
    });

    const { getItems, items } = useItems(collectionRef, query);

    // 获取系统主题色
    const fetchThemeColor = async () => {
        try {
            loading.value = true;
            error.value = null;
            console.log('[useThemeColor] 开始获取系统主题色...');
            console.log('[useThemeColor] getItems 函数类型:', typeof getItems);
            
            await getItems();
            // [TODO] 目前这一步会报错：
            //  Uncaught (in promise) TypeError: Cannot read properties of undefined (reading 'countDistinct')
            // 导致没法正确读取到系统设置数据。所以暂时还是只能用写死的颜色。
            
            console.log('[useThemeColor] getItems 调用完成');
            console.log('[useThemeColor] 获取到的 items:', items.value);
            console.log('[useThemeColor] items 数量:', items.value?.length);
            console.log('[useThemeColor] items 类型:', typeof items.value);
            
            if (items.value && Array.isArray(items.value)) {
                console.log('[useThemeColor] items 是数组，第一个元素:', items.value[0]);
            }
            
            settings.value = items.value?.[0] || null;
            console.log('[useThemeColor] 解析的 settings:', settings.value);
            
            if (settings.value?.project_color) {
                console.log('[useThemeColor] 找到项目颜色:', settings.value.project_color);
            } else {
                console.log('[useThemeColor] 未找到项目颜色，将使用默认颜色');
                console.log('[useThemeColor] settings.value 的所有键:', settings.value ? Object.keys(settings.value) : 'settings.value 为空');
            }
            
        } catch (err) {
            error.value = '获取系统主题色失败';
            console.error('[useThemeColor] 获取系统主题色失败:', err);
            console.error('[useThemeColor] 错误详情:', err instanceof Error ? err.message : err);
        } finally {
            loading.value = false;
            console.log('[useThemeColor] 获取主题色流程结束');
        }
    };

    // 计算最终的主题色
    const themeColor = computed(() => {
        const projectColor = settings.value?.project_color;
        const finalColor = projectColor && projectColor.trim() !== '' ? projectColor : DEFAULT_THEME_COLOR;
        
        console.log('[useThemeColor] 计算主题色:', {
            原始颜色: projectColor,
            最终颜色: finalColor,
            是否使用默认: !projectColor || projectColor.trim() === ''
        });
        
        return finalColor;
    });

    // CSS 变量字符串（只用于UI元素）
    const themeColorCSSVars = computed(() => {
        const vars = {
            '--ui-theme-color': themeColor.value,
        };
        
        console.log('[useThemeColor] 生成的 CSS 变量:', vars);
        
        return vars;
    });

    return {
        themeColor,
        themeColorCSSVars,
        loading,
        error,
        fetchThemeColor,
    };
} 