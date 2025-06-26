import { ref, computed } from 'vue';
import { useItems } from '@directus/extensions-sdk';

// 默认主题色（如果系统没有设置的话）
const DEFAULT_THEME_COLOR = '#6366f1';

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

    const { getItems, items } = useItems(collectionRef, query);

    // 获取系统主题色
    const fetchThemeColor = async () => {
        try {
            loading.value = true;
            error.value = null;
            await getItems();
            settings.value = items.value?.[0] || null;
        } catch (err) {
            error.value = '获取系统主题色失败';
            console.error('Failed to fetch theme color:', err);
        } finally {
            loading.value = false;
        }
    };

    // 计算最终的主题色
    const themeColor = computed(() => {
        const projectColor = settings.value?.project_color;
        return projectColor && projectColor.trim() !== '' ? projectColor : DEFAULT_THEME_COLOR;
    });

    // CSS 变量字符串（只用于UI元素）
    const themeColorCSSVars = computed(() => ({
        '--ui-theme-color': themeColor.value,
    }));

    return {
        themeColor,
        themeColorCSSVars,
        loading,
        error,
        fetchThemeColor,
    };
} 