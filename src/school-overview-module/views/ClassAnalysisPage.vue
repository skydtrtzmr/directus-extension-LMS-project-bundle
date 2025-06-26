<template>
    <div class="class-analysis-container" :style="themeColorCSSVars">
        <!-- 班级选择器 -->
        <div class="class-selector-card">
            <h3>选择班级</h3>
            <div class="class-selector">
                <v-select 
                    v-model="selectedClass"
                    :items="classes"
                    item-text="name"
                    item-value="id"
                    placeholder="请选择班级"
                    @update:model-value="onClassChange"
                />
            </div>
        </div>

        <!-- 班级统计卡片 -->
        <div class="stats-grid" v-if="currentClassData">
            <div class="stat-card">
                <div class="stat-icon">
                    <v-icon name="people" />
                </div>
                <div class="stat-content">
                    <h3>{{ currentClassData.studentCount }}</h3>
                    <p>学生人数</p>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">
                    <v-icon name="grade" />
                </div>
                <div class="stat-content">
                    <h3>{{ currentClassData.averageScore }}</h3>
                    <p>班级平均分</p>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">
                    <v-icon name="trending_up" />
                </div>
                <div class="stat-content">
                    <h3>{{ currentClassData.attendanceRate }}%</h3>
                    <p>出勤率</p>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">
                    <v-icon name="star" />
                </div>
                <div class="stat-content">
                    <h3>{{ currentClassData.ranking }}</h3>
                    <p>班级排名</p>
                </div>
            </div>
        </div>

        <!-- 图表区域 -->
        <div class="charts-grid" v-if="currentClassData && chartData">
            <!-- 班级成绩分布 -->
            <div class="chart-card">
                <h4>{{ currentClassData.name }} - 成绩分布</h4>
                <ChartComponent 
                    type="bar" 
                    :data="chartData.scoreDistribution" 
                    :width="400" 
                    :height="250"
                />
            </div>

            <!-- 学科平均分对比 -->
            <div class="chart-card">
                <h4>{{ currentClassData.name }} - 各学科平均分</h4>
                <ChartComponent 
                    type="bar" 
                    :data="chartData.subjectAverages" 
                    :width="400" 
                    :height="250"
                />
            </div>

            <!-- 出勤率趋势 -->
            <div class="chart-card">
                <h4>{{ currentClassData.name }} - 出勤率趋势</h4>
                <ChartComponent 
                    type="line" 
                    :data="chartData.attendanceRate" 
                    :width="400" 
                    :height="250"
                />
            </div>

            <!-- 作业完成情况 -->
            <div class="chart-card">
                <h4>{{ currentClassData.name }} - 作业完成情况</h4>
                <ChartComponent 
                    type="pie" 
                    :data="chartData.homeworkCompletion" 
                    :width="400" 
                    :height="300"
                />
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import ChartComponent from '../ChartComponent.vue';
import { DataService } from '../services/dataService';
import type { ClassInfo } from '../services/mockData';
import { useThemeColor } from '../composables/useThemeColor';

const classes = ref<ClassInfo[]>([]);
const selectedClass = ref<string>('');
const chartData = ref<any>(null);

// 使用系统主题色（只用于UI元素）
const { themeColorCSSVars, fetchThemeColor } = useThemeColor();

const currentClassData = computed(() => 
    classes.value.find(cls => cls.id === selectedClass.value) || null
);

const onClassChange = async (classId: string) => {
    selectedClass.value = classId;
    await loadChartData(classId);
};

const loadChartData = async (classId: string) => {
    try {
        chartData.value = await DataService.getClassChartData(classId);
    } catch (error) {
        console.error('Failed to load chart data:', error);
    }
};

const loadClasses = async () => {
    try {
        const classList = await DataService.getClasses();
        classes.value = classList;
        if (classList.length > 0) {
            const firstClass = classList[0]!;
            selectedClass.value = firstClass.id;
            await loadChartData(firstClass.id);
        }
    } catch (error) {
        console.error('Failed to load classes:', error);
    }
};

onMounted(async () => {
    await Promise.all([loadClasses(), fetchThemeColor()]);
});
</script>

<style scoped>
.class-analysis-container {
    padding: 20px;
}

.class-selector-card {
    background: white;
    padding: 20px;
    border-radius: 8px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    margin-bottom: 20px;
}

.class-selector-card h3 {
    margin: 0 0 15px 0;
    color: #1f2937;
}

.class-selector {
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