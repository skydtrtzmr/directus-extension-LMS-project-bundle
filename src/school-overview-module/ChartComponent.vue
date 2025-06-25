<template>
    <div class="chart-wrapper">
        <div class="chart-legend" v-if="showLegend">
            <div 
                v-for="(item, index) in legendItems" 
                :key="index" 
                class="legend-item"
            >
                <div 
                    class="legend-color" 
                    :style="{ backgroundColor: item.color }"
                ></div>
                <span class="legend-label">{{ item.label }}</span>
            </div>
        </div>
        <canvas 
            ref="chartCanvas" 
            :width="width" 
            :height="height"
            class="chart-canvas"
        ></canvas>
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick, computed } from 'vue';

interface Props {
    type: 'line' | 'bar' | 'pie';
    data: any;
    width?: number;
    height?: number;
    showLegend?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
    width: 400,
    height: 200,
    showLegend: true
});

const chartCanvas = ref<HTMLCanvasElement>();

const legendItems = computed(() => {
    if (!props.data) return [];
    
    if (props.type === 'pie') {
        return props.data.labels.map((label: string, index: number) => ({
            label,
            color: props.data.datasets[0].backgroundColor[index]
        }));
    } else {
        return props.data.datasets.map((dataset: any) => ({
            label: dataset.label,
            color: dataset.borderColor || dataset.backgroundColor
        }));
    }
});

const drawChart = (canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d');
    if (!ctx || !props.data) return;
    
    // 清空画布
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    if (props.type === 'line') {
        drawLineChart(ctx, canvas);
    } else if (props.type === 'pie') {
        drawPieChart(ctx, canvas);
    } else if (props.type === 'bar') {
        drawBarChart(ctx, canvas);
    }
};

const drawLineChart = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => {
    const padding = 50;
    const width = canvas.width - padding * 2;
    const height = canvas.height - padding * 2;
    
    // 绘制背景网格
    ctx.strokeStyle = '#f0f0f0';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
        const y = padding + (height / 5) * i;
        ctx.beginPath();
        ctx.moveTo(padding, y);
        ctx.lineTo(padding + width, y);
        ctx.stroke();
    }
    
    // 绘制坐标轴
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(padding, padding);
    ctx.lineTo(padding, padding + height);
    ctx.lineTo(padding + width, padding + height);
    ctx.stroke();
    
    // 绘制数据线
    props.data.datasets.forEach((dataset: any) => {
        ctx.strokeStyle = dataset.borderColor;
        ctx.lineWidth = 3;
        ctx.beginPath();
        
        dataset.data.forEach((value: number, i: number) => {
            const x = padding + (width / (dataset.data.length - 1)) * i;
            const y = padding + height - (value / 100) * height;
            
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });
        
        ctx.stroke();
        
        // 绘制数据点
        ctx.fillStyle = dataset.borderColor;
        dataset.data.forEach((value: number, i: number) => {
            const x = padding + (width / (dataset.data.length - 1)) * i;
            const y = padding + height - (value / 100) * height;
            
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, 2 * Math.PI);
            ctx.fill();
        });
    });
    
    // 绘制标签
    ctx.fillStyle = '#666';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    props.data.labels.forEach((label: string, i: number) => {
        const x = padding + (width / (props.data.labels.length - 1)) * i;
        ctx.fillText(label, x, padding + height + 20);
    });
};

const drawPieChart = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => {
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = Math.min(centerX, centerY) - 40;
    
    const total = props.data.datasets[0].data.reduce((sum: number, val: number) => sum + val, 0);
    let currentAngle = -Math.PI / 2;
    
    props.data.datasets[0].data.forEach((value: number, index: number) => {
        const sliceAngle = (value / total) * 2 * Math.PI;
        
        // 绘制扇形
        ctx.fillStyle = props.data.datasets[0].backgroundColor[index];
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.arc(centerX, centerY, radius, currentAngle, currentAngle + sliceAngle);
        ctx.closePath();
        ctx.fill();
        
        // 绘制边框
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
        
        // 绘制百分比标签
        const labelAngle = currentAngle + sliceAngle / 2;
        const labelX = centerX + Math.cos(labelAngle) * (radius * 0.7);
        const labelY = centerY + Math.sin(labelAngle) * (radius * 0.7);
        
        const percentage = ((value / total) * 100).toFixed(1);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(`${percentage}%`, labelX, labelY);
        
        currentAngle += sliceAngle;
    });
};

const drawBarChart = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => {
    const padding = 50;
    const width = canvas.width - padding * 2;
    const height = canvas.height - padding * 2;
    const barWidth = width / props.data.labels.length - 20;
    
    // 绘制背景网格
    ctx.strokeStyle = '#f0f0f0';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
        const y = padding + (height / 5) * i;
        ctx.beginPath();
        ctx.moveTo(padding, y);
        ctx.lineTo(padding + width, y);
        ctx.stroke();
    }
    
    // 绘制坐标轴
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(padding, padding);
    ctx.lineTo(padding, padding + height);
    ctx.lineTo(padding + width, padding + height);
    ctx.stroke();
    
    // 绘制柱状图
    const maxValue = Math.max(...props.data.datasets[0].data);
    ctx.fillStyle = props.data.datasets[0].backgroundColor;
    
    props.data.datasets[0].data.forEach((value: number, index: number) => {
        const barHeight = (value / maxValue) * height;
        const x = padding + index * (barWidth + 20) + 10;
        const y = padding + height - barHeight;
        
        // 绘制柱子
        ctx.fillRect(x, y, barWidth, barHeight);
        
        // 绘制数值标签
        ctx.fillStyle = '#333';
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(value.toString(), x + barWidth / 2, y - 5);
        
        // 绘制底部标签
        ctx.fillText(props.data.labels[index], x + barWidth / 2, padding + height + 20);
        
        ctx.fillStyle = props.data.datasets[0].backgroundColor;
    });
};

onMounted(async () => {
    await nextTick();
    if (chartCanvas.value) {
        drawChart(chartCanvas.value);
    }
});
</script>

<style scoped>
.chart-wrapper {
    position: relative;
}

.chart-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-bottom: 15px;
    justify-content: center;
}

.legend-item {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
}

.legend-color {
    width: 12px;
    height: 12px;
    border-radius: 2px;
}

.legend-label {
    color: #666;
}

.chart-canvas {
    border-radius: 4px;
    max-width: 100%;
    height: auto;
}
</style> 