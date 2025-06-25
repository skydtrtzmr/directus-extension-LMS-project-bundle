<template>
    <private-view title="学校概况">
        <template #headline>
            <v-breadcrumb :items="[{ name: '学校概况', disabled: true }]" />
        </template>

        <div class="overview-container">
            <!-- 顶部统计卡片 -->
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-icon">
                        <v-icon name="people" />
                    </div>
                    <div class="stat-content">
                        <h3>{{ totalUsers }}</h3>
                        <p>总用户数</p>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon">
                        <v-icon name="school" />
                    </div>
                    <div class="stat-content">
                        <h3>{{ totalStudents }}</h3>
                        <p>学生人数</p>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon">
                        <v-icon name="person" />
                    </div>
                    <div class="stat-content">
                        <h3>{{ totalTeachers }}</h3>
                        <p>教师人数</p>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon">
                        <v-icon name="book" />
                    </div>
                    <div class="stat-content">
                        <h3>{{ totalCourses }}</h3>
                        <p>课程数量</p>
                    </div>
                </div>
            </div>

            <!-- 图表区域 -->
            <div class="charts-grid">
                <!-- 师生活跃度线性图 -->
                <div class="chart-card">
                    <h4>师生活跃度趋势</h4>
                    <ChartComponent 
                        type="line" 
                        :data="activityData" 
                        :width="400" 
                        :height="250"
                    />
                </div>

                <!-- 课程分布饼状图 -->
                <div class="chart-card">
                    <h4>课程类型分布</h4>
                    <ChartComponent 
                        type="pie" 
                        :data="courseDistributionData" 
                        :width="400" 
                        :height="300"
                    />
                </div>

                <!-- 学生成绩分布柱状图 -->
                <div class="chart-card">
                    <h4>学生成绩分布</h4>
                    <ChartComponent 
                        type="bar" 
                        :data="gradeDistributionData" 
                        :width="400" 
                        :height="250"
                    />
                </div>

                <!-- 月度注册用户趋势 -->
                <div class="chart-card">
                    <h4>月度注册用户趋势</h4>
                    <ChartComponent 
                        type="line" 
                        :data="registrationData" 
                        :width="400" 
                        :height="250"
                    />
                </div>
            </div>
        </div>
    </private-view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import ChartComponent from './ChartComponent.vue';

// 统计数据
const totalUsers = ref(1248);
const totalStudents = ref(956);
const totalTeachers = ref(92);
const totalCourses = ref(156);

// Mock数据
const activityData = {
    labels: ['1月', '2月', '3月', '4月', '5月', '6月'],
    datasets: [
        {
            label: '学生活跃度',
            data: [85, 92, 78, 95, 88, 94],
            borderColor: 'rgb(75, 192, 192)',
            backgroundColor: 'rgba(75, 192, 192, 0.2)',
            tension: 0.4
        },
        {
            label: '教师活跃度',
            data: [78, 88, 85, 90, 82, 87],
            borderColor: 'rgb(255, 99, 132)',
            backgroundColor: 'rgba(255, 99, 132, 0.2)',
            tension: 0.4
        }
    ]
};

const courseDistributionData = {
    labels: ['计算机科学', '数学', '物理', '化学', '语言文学', '其他'],
    datasets: [{
        data: [35, 25, 15, 10, 10, 5],
        backgroundColor: [
            '#FF6384',
            '#36A2EB',
            '#FFCE56',
            '#4BC0C0',
            '#9966FF',
            '#FF9F40'
        ]
    }]
};

const gradeDistributionData = {
    labels: ['90-100', '80-89', '70-79', '60-69', '60以下'],
    datasets: [{
        label: '学生人数',
        data: [156, 298, 234, 167, 89],
        backgroundColor: 'rgba(54, 162, 235, 0.6)',
        borderColor: 'rgba(54, 162, 235, 1)',
        borderWidth: 1
    }]
};

const registrationData = {
    labels: ['7月', '8月', '9月', '10月', '11月', '12月'],
    datasets: [{
        label: '新注册用户',
        data: [45, 67, 123, 89, 76, 98],
        borderColor: 'rgb(153, 102, 255)',
        backgroundColor: 'rgba(153, 102, 255, 0.2)',
        tension: 0.4
    }]
};


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