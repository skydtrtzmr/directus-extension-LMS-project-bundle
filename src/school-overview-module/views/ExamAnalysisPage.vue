<template>
    <div class="exam-analysis-container" :style="themeColorCSSVars">
        <!-- 考试选择器 -->
        <div class="exam-selector-card">
            <h3>选择考试</h3>
            <div class="exam-selector">
                <v-select 
                    v-model="selectedExam"
                    :items="exams"
                    item-text="name"
                    item-value="id"
                    placeholder="请选择考试"
                    @update:model-value="onExamChange"
                />
            </div>
        </div>

        <!-- 考试统计卡片 -->
        <div class="stats-grid" v-if="currentExamData">
            <div class="stat-card">
                <div class="stat-icon">
                    <v-icon name="people" />
                </div>
                <div class="stat-content">
                    <h3>{{ currentExamData.participantCount }}</h3>
                    <p>参考人数</p>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">
                    <v-icon name="grade" />
                </div>
                <div class="stat-content">
                    <h3>{{ currentExamData.averageScore }}</h3>
                    <p>平均分</p>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">
                    <v-icon name="trending_up" />
                </div>
                <div class="stat-content">
                    <h3>{{ currentExamData.passRate }}%</h3>
                    <p>及格率</p>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">
                    <v-icon name="timer" />
                </div>
                <div class="stat-content">
                    <h3>{{ currentExamData.avgDuration }}分钟</h3>
                    <p>平均用时</p>
                </div>
            </div>
        </div>

        <!-- 图表区域 -->
        <div class="charts-grid" v-if="currentExamData && chartData">
            <!-- 成绩分布 -->
            <div class="chart-card">
                <h4>{{ currentExamData.name }} - 成绩分布</h4>
                <ChartComponent 
                    type="bar" 
                    :data="chartData.scoreDistribution" 
                    :width="400" 
                    :height="250"
                />
            </div>

            <!-- 正态分布图 -->
            <div class="chart-card">
                <h4>{{ currentExamData.name }} - 得分正态分布</h4>
                <ChartComponent 
                    type="line" 
                    :data="chartData.normalDistribution"
                    :width="400" 
                    :height="250"
                />
            </div>

            <!-- 题目正确率 -->
            <div class="chart-card">
                <h4>{{ currentExamData.name }} - 各题正确率</h4>
                <ChartComponent 
                    type="bar" 
                    :data="chartData.questionAccuracy" 
                    :width="400" 
                    :height="250"
                />
            </div>

            <!-- 时间分布 -->
            <div class="chart-card">
                <h4>{{ currentExamData.name }} - 答题时间分布</h4>
                <ChartComponent 
                    type="pie" 
                    :data="chartData.timeDistribution" 
                    :width="400" 
                    :height="300"
                />
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import ChartComponent from '../ChartComponent.vue';
import { DataService } from '../services/dataService';
import type { Exam } from '../services/mockData';
import { useThemeColor } from '../composables/useThemeColor';

const exams = ref<Exam[]>([]);
const selectedExam = ref<string>('');
const chartData = ref<any>(null);

// 使用系统主题色（只用于UI元素）
const { themeColorCSSVars, fetchThemeColor } = useThemeColor();

const currentExamData = computed(() => 
    exams.value.find(exam => exam.id === selectedExam.value) || null
);

const onExamChange = async (examId: string) => {
    selectedExam.value = examId;
    await loadChartData(examId);
};

const loadChartData = async (examId: string) => {
    try {
        chartData.value = await DataService.getExamChartData(examId);
    } catch (error) {
        console.error('Failed to load chart data:', error);
    }
};

const loadExams = async () => {
    try {
        const examList = await DataService.getExams();
        exams.value = examList;
        if (examList.length > 0) {
            const firstExam = examList[0]!;
            selectedExam.value = firstExam.id;
            await loadChartData(firstExam.id);
        }
    } catch (error) {
        console.error('Failed to load exams:', error);
    }
};

onMounted(async () => {
    await Promise.all([loadExams(), fetchThemeColor()]);
});
</script>

<style scoped>
.exam-analysis-container {
    padding: 20px;
}

.exam-selector-card {
    background: white;
    padding: 20px;
    border-radius: 8px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    margin-bottom: 20px;
}

.exam-selector-card h3 {
    margin: 0 0 15px 0;
    color: #1f2937;
}

.exam-selector {
    max-width: 300px;
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