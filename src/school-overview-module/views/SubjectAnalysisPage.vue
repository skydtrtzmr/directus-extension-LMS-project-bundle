<template>
    <div class="subject-analysis-container" :style="themeColorCSSVars">
        <!-- 学科选择器 -->
        <div class="subject-selector-card">
            <h3>选择学科</h3>
            <div class="subject-buttons">
                <button
                    v-for="subject in subjects"
                    :key="subject.id"
                    @click="selectSubject(subject)"
                    class="subject-btn"
                    :class="{ active: selectedSubject && selectedSubject.id === subject.id }"
                >
                    <v-icon :name="subject.icon" />
                    <span>{{ subject.name }}</span>
                </button>
            </div>
        </div>

        <!-- 学科统计卡片 -->
        <div class="stats-grid" v-if="selectedSubject">
            <div class="stat-card">
                <div class="stat-icon">
                    <v-icon name="people" />
                </div>
                <div class="stat-content">
                    <h3>{{ selectedSubject.studentCount }}</h3>
                    <p>选课学生数</p>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">
                    <v-icon name="person" />
                </div>
                <div class="stat-content">
                    <h3>{{ selectedSubject.teacherCount }}</h3>
                    <p>任课教师数</p>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">
                    <v-icon name="class" />
                </div>
                <div class="stat-content">
                    <h3>{{ selectedSubject.courseCount }}</h3>
                    <p>开设课程数</p>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">
                    <v-icon name="grade" />
                </div>
                <div class="stat-content">
                    <h3>{{ selectedSubject.averageScore }}</h3>
                    <p>平均成绩</p>
                </div>
            </div>
        </div>

        <!-- 图表区域 -->
        <div class="charts-grid" v-if="selectedSubject && chartData">
            <!-- 学科成绩趋势 -->
            <div class="chart-card">
                <h4>{{ selectedSubject.name }} - 成绩趋势</h4>
                <ChartComponent 
                    type="line" 
                    :data="chartData.scoreTrend" 
                    :width="400" 
                    :height="250"
                />
            </div>

            <!-- 学科难度分布 -->
            <div class="chart-card">
                <h4>{{ selectedSubject.name }} - 题目难度分布</h4>
                <ChartComponent 
                    type="pie" 
                    :data="chartData.difficultyDistribution" 
                    :width="400" 
                    :height="300"
                />
            </div>

            <!-- 学习时长统计 -->
            <div class="chart-card">
                <h4>{{ selectedSubject.name }} - 学习时长分布</h4>
                <ChartComponent 
                    type="bar" 
                    :data="chartData.studyTime" 
                    :width="400" 
                    :height="250"
                />
            </div>

            <!-- 知识点掌握情况 -->
            <div class="chart-card">
                <h4>{{ selectedSubject.name }} - 知识点掌握率</h4>
                <ChartComponent 
                    type="bar" 
                    :data="chartData.knowledgePoint" 
                    :width="400" 
                    :height="250"
                />
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import ChartComponent from '../ChartComponent.vue';
import { DataService } from '../services/dataService';
import type { Subject } from '../services/mockData';
import { useThemeColor } from '../composables/useThemeColor';

const subjects = ref<Subject[]>([]);
const selectedSubject = ref<Subject | null>(null);
const chartData = ref<any>(null);

// 使用系统主题色（只用于UI元素）
const { themeColorCSSVars, fetchThemeColor } = useThemeColor();

const selectSubject = async (subject: Subject) => {
    selectedSubject.value = subject;
    await loadChartData(subject.id);
};

const loadChartData = async (subjectId: string) => {
    try {
        chartData.value = await DataService.getSubjectChartData(subjectId);
    } catch (error) {
        console.error('Failed to load chart data:', error);
    }
};

const loadSubjects = async () => {
    try {
        const subjectList = await DataService.getSubjects();
        subjects.value = subjectList;
        if (subjectList.length > 0) {
            const firstSubject = subjectList[0]!;
            selectedSubject.value = firstSubject;
            await loadChartData(firstSubject.id);
        }
    } catch (error) {
        console.error('Failed to load subjects:', error);
    }
};

onMounted(async () => {
    await Promise.all([loadSubjects(), fetchThemeColor()]);
});
</script>

<style scoped>
.subject-analysis-container {
    padding: 20px;
}

.subject-selector-card {
    background: white;
    padding: 20px;
    border-radius: 8px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    margin-bottom: 20px;
}

.subject-selector-card h3 {
    margin: 0 0 15px 0;
    color: #1f2937;
}

.subject-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
}

.subject-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    border: 2px solid #e5e7eb;
    background: white;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s ease;
    color: #6b7280;
}

.subject-btn:hover {
    border-color: var(--ui-theme-color, #6366f1);
    color: var(--ui-theme-color, #6366f1);
}

.subject-btn.active {
    border-color: var(--ui-theme-color, #6366f1);
    background: var(--ui-theme-color, #6366f1);
    color: white;
}

.stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: 20px;
    margin-bottom: 30px;
}

.stat-card {
    background: white;
    padding: 20px;
    border-radius: 8px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    display: flex;
    align-items: center;
    gap: 15px;
}

.stat-icon {
    background: var(--ui-theme-color, #6366f1);
    color: white;
    width: 50px;
    height: 50px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
}

.stat-content h3 {
    margin: 0;
    font-size: 24px;
    font-weight: bold;
    color: #1f2937;
}

.stat-content p {
    margin: 5px 0 0 0;
    color: #6b7280;
    font-size: 14px;
}

.charts-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
    gap: 20px;
}

.chart-card {
    background: white;
    padding: 20px;
    border-radius: 8px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.chart-card h4 {
    margin: 0 0 15px 0;
    font-size: 16px;
    font-weight: 600;
    color: #1f2937;
}
</style> 