<template>
    <div class="overview-container" :style="themeColorCSSVars">
        <!-- 统计卡片区域 -->
        <div class="stats-grid" v-if="schoolData">
            <div class="stat-card">
                <div class="stat-icon">
                    <v-icon name="people" />
                </div>
                <div class="stat-content">
                    <h3>{{ schoolData.totalUsers }}</h3>
                    <p>总用户数</p>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">
                    <v-icon name="school" />
                </div>
                <div class="stat-content">
                    <h3>{{ schoolData.totalStudents }}</h3>
                    <p>学生人数</p>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">
                    <v-icon name="person" />
                </div>
                <div class="stat-content">
                    <h3>{{ schoolData.totalTeachers }}</h3>
                    <p>教师人数</p>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">
                    <v-icon name="class" />
                </div>
                <div class="stat-content">
                    <h3>{{ schoolData.totalCourses }}</h3>
                    <p>课程数量</p>
                </div>
            </div>
        </div>

        <!-- 图表区域 -->
        <div class="charts-grid" v-if="schoolData">
            <!-- 师生活跃度趋势 -->
            <div class="chart-card">
                <h4>师生活跃度趋势</h4>
                <ChartComponent 
                    type="line" 
                    :data="schoolData.activityData" 
                    :width="400" 
                    :height="250"
                />
            </div>

            <!-- 课程类型分布 -->
            <div class="chart-card">
                <h4>课程类型分布</h4>
                <ChartComponent 
                    type="pie" 
                    :data="schoolData.courseDistributionData" 
                    :width="400" 
                    :height="300"
                />
            </div>

            <!-- 学生成绩分布 -->
            <div class="chart-card">
                <h4>学生成绩分布</h4>
                <ChartComponent 
                    type="bar" 
                    :data="schoolData.gradeDistributionData" 
                    :width="400" 
                    :height="250"
                />
            </div>

            <!-- 月度注册趋势 -->
            <div class="chart-card">
                <h4>月度注册趋势</h4>
                <ChartComponent 
                    type="line" 
                    :data="schoolData.registrationData" 
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
import { useThemeColor } from '../composables/useThemeColor';

const schoolData = ref<any>(null);

// 使用系统主题色（只用于UI元素）
const { themeColorCSSVars, fetchThemeColor } = useThemeColor();

const loadSchoolData = async () => {
    try {
        schoolData.value = await DataService.getSchoolOverviewData();
    } catch (error) {
        console.error('Failed to load school data:', error);
    }
};

onMounted(async () => {
    await Promise.all([loadSchoolData(), fetchThemeColor()]);
});
</script>

<style scoped>
.overview-container {
    padding: 20px;
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