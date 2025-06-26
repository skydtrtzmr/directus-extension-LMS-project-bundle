<template>
    <private-view title="统计分析" :style="themeColorCSSVars">
        <template #headline>
            <v-breadcrumb :items="breadcrumbItems" />
        </template>

        <template #navigation>
            <div class="navigation-menu">
                <nav class="nav-list">
                    <button
                        v-for="item in navigationItems"
                        :key="item.key"
                        @click="handleNavigation(item.key)"
                        class="nav-item"
                        :class="{ active: currentPage === item.key }"
                    >
                        <v-icon :name="item.icon" />
                        <span>{{ item.name }}</span>
                    </button>
                </nav>
            </div>
        </template>

        <div class="module-content">
            <OverviewPage v-if="currentPage === 'overview'" />
            <SubjectAnalysisPage v-else-if="currentPage === 'subjects'" />
            <ExamAnalysisPage v-else-if="currentPage === 'exams'" />
            <ClassAnalysisPage v-else-if="currentPage === 'classes'" />
        </div>
    </private-view>
</template>

<script setup lang="ts">

import { ref, computed, onMounted } from 'vue';
import OverviewPage from './OverviewPage.vue';
import SubjectAnalysisPage from './SubjectAnalysisPage.vue';
import ExamAnalysisPage from './ExamAnalysisPage.vue';
import ClassAnalysisPage from './ClassAnalysisPage.vue';
import { useThemeColor } from '../composables/useThemeColor';

const currentPage = ref('overview');

// 使用系统主题色
const { themeColorCSSVars, fetchThemeColor, themeColor, loading, error } = useThemeColor();

const navigationItems = [
    {
        name: '学校概况',
        key: 'overview',
        icon: 'school',
    },
    {
        name: '学科分析',
        key: 'subjects',
        icon: 'subject',
    },
    {
        name: '考试分析',
        key: 'exams',
        icon: 'quiz',
    },
    {
        name: '班级分析',
        key: 'classes',
        icon: 'groups',
    },
];

const breadcrumbItems = computed(() => {
    const currentItem = navigationItems.find(item => item.key === currentPage.value);
    return [
        { name: '统计分析', disabled: true },
        { name: currentItem?.name || '概况', disabled: true },
    ];
});

const handleNavigation = (key: string) => {
    currentPage.value = key;
};

onMounted(async () => {

    try {
        await fetchThemeColor();
        console.log('[ModuleView] 获取主题色完成');
        console.log('[ModuleView] 最终主题色:', themeColor.value);
        console.log('[ModuleView] CSS变量:', themeColorCSSVars.value);
    } catch (err) {
        console.error('[ModuleView] 获取主题色失败:', err);
    }
});
</script>

<style scoped>
.navigation-menu {
    padding: 20px 0;
}

.nav-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.nav-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 20px;
    color: var(--foreground-subdued);
    text-decoration: none;
    border-radius: 4px;
    transition: all 0.2s ease;
    margin: 0 12px;
    border: none;
    background: none;
    cursor: pointer;
    width: calc(100% - 24px);
    text-align: left;
}

.nav-item:hover {
    background-color: var(--background-subdued);
    color: var(--foreground-normal);
}

.nav-item.active {
    background-color: var(--ui-theme-color, var(--primary));
    color: var(--primary-foreground);
}

.nav-item .v-icon {
    font-size: 18px;
}

.nav-item span {
    font-weight: 500;
}

.module-content {
    padding: 0;
    height: 100%;
}
</style> 