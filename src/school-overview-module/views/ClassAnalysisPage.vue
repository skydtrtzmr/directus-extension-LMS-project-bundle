<template>
    <div class="class-analysis-container">
        <!-- 班级选择器 -->
        <div class="class-selector-card">
            <h3>选择班级</h3>
            <div class="class-buttons">
                <button
                    v-for="classInfo in classes"
                    :key="classInfo.id"
                    @click="selectClass(classInfo)"
                    class="class-btn"
                    :class="{ active: selectedClass && selectedClass.id === classInfo.id }"
                >
                    <v-icon name="class" />
                    <span>{{ classInfo.name }}</span>
                </button>
            </div>
        </div>

        <!-- 班级统计卡片 -->
        <div class="stats-grid" v-if="selectedClass">
            <div class="stat-card">
                <div class="stat-icon">
                    <v-icon name="people" />
                </div>
                <div class="stat-content">
                    <h3>{{ selectedClass.studentCount }}</h3>
                    <p>班级人数</p>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">
                    <v-icon name="grade" />
                </div>
                <div class="stat-content">
                    <h3>{{ selectedClass.averageScore }}</h3>
                    <p>班级平均分</p>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">
                    <v-icon name="trending_up" />
                </div>
                <div class="stat-content">
                    <h3>{{ selectedClass.attendanceRate }}%</h3>
                    <p>出勤率</p>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">
                    <v-icon name="star" />
                </div>
                <div class="stat-content">
                    <h3>{{ selectedClass.ranking }}</h3>
                    <p>班级排名</p>
                </div>
            </div>
        </div>

        <!-- 图表区域 -->
        <div class="charts-grid" v-if="selectedClass && chartData">
            <!-- 班级成绩分布 -->
            <div class="chart-card">
                <h4>{{ selectedClass.name }} - 成绩分布</h4>
                <ChartComponent 
                    type="bar" 
                    :data="chartData.scoreDistribution" 
                    :width="400" 
                    :height="250"
                />
            </div>

            <!-- 各科成绩对比 -->
            <div class="chart-card">
                <h4>{{ selectedClass.name }} - 各科成绩对比</h4>
                <ChartComponent 
                    type="line" 
                    :data="chartData.subjectComparison" 
                    :width="400" 
                    :height="250"
                />
            </div>

            <!-- 学习活跃度 -->
            <div class="chart-card">
                <h4>{{ selectedClass.name }} - 学习活跃度</h4>
                <ChartComponent 
                    type="pie" 
                    :data="chartData.activityLevel" 
                    :width="400" 
                    :height="300"
                />
            </div>

            <!-- 月度表现趋势 -->
            <div class="chart-card">
                <h4>{{ selectedClass.name }} - 月度表现趋势</h4>
                <ChartComponent 
                    type="line" 
                    :data="chartData.monthlyTrend" 
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
import type { ClassInfo } from '../services/mockData';

const classes = ref<ClassInfo[]>([]);
const selectedClass = ref<ClassInfo | null>(null);
const chartData = ref<any>(null);

const selectClass = async (classInfo: ClassInfo) => {
    selectedClass.value = classInfo;
    await loadChartData(classInfo.id);
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
            selectedClass.value = firstClass;
            await loadChartData(firstClass.id);
        }
    } catch (error) {
        console.error('Failed to load classes:', error);
    }
};

onMounted(() => {
    loadClasses();
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

.class-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
}

.class-btn {
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

.class-btn:hover {
    border-color: #6366f1;
    color: #6366f1;
}

.class-btn.active {
    border-color: #6366f1;
    background: #6366f1;
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
    background: #6366f1;
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