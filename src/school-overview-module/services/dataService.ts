import {
    subjects,
    exams,
    classes,
    subjectChartData,
    examChartData,
    classChartData,
    schoolOverviewData,
    type Subject,
    type Exam,
    type ClassInfo
} from './mockData';

// 模拟异步数据获取
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export class DataService {
    // 获取学科列表
    static async getSubjects(): Promise<Subject[]> {
        await delay(100); // 模拟网络延迟
        return [...subjects];
    }

    // 获取单个学科信息
    static async getSubjectById(id: string): Promise<Subject | null> {
        await delay(50);
        return subjects.find(subject => subject.id === id) || null;
    }

    // 获取学科图表数据
    static async getSubjectChartData(subjectId: string) {
        await delay(100);
        const scoreData = subjectChartData.scoreData[subjectId as keyof typeof subjectChartData.scoreData] || [];
        const difficultyData = subjectChartData.difficultyData[subjectId as keyof typeof subjectChartData.difficultyData] || [];
        const studyTimeData = subjectChartData.studyTimeData[subjectId as keyof typeof subjectChartData.studyTimeData] || [];
        const knowledgePointData = subjectChartData.knowledgePointData[subjectId as keyof typeof subjectChartData.knowledgePointData] || { labels: [], scores: [] };

        return {
            scoreTrend: {
                labels: ['第1周', '第2周', '第3周', '第4周', '第5周', '第6周'],
                datasets: [{
                    label: '平均成绩',
                    data: scoreData,
                    borderColor: 'rgb(54, 162, 235)',
                    backgroundColor: 'rgba(54, 162, 235, 0.2)',
                    tension: 0.4
                }]
            },
            difficultyDistribution: {
                labels: ['简单', '中等', '困难', '极难'],
                datasets: [{
                    data: difficultyData,
                    backgroundColor: ['#4CAF50', '#FF9800', '#FF5722', '#9C27B0']
                }]
            },
            studyTime: {
                labels: ['0-1小时', '1-2小时', '2-3小时', '3-4小时', '4小时以上'],
                datasets: [{
                    label: '学生人数',
                    data: studyTimeData,
                    backgroundColor: 'rgba(255, 159, 64, 0.6)',
                    borderColor: 'rgba(255, 159, 64, 1)',
                    borderWidth: 1
                }]
            },
            knowledgePoint: {
                labels: knowledgePointData.labels,
                datasets: [{
                    label: '掌握率(%)',
                    data: knowledgePointData.scores,
                    backgroundColor: 'rgba(75, 192, 192, 0.6)',
                    borderColor: 'rgba(75, 192, 192, 1)',
                    borderWidth: 1
                }]
            }
        };
    }

    // 获取考试列表
    static async getExams(): Promise<Exam[]> {
        await delay(100);
        return [...exams];
    }

    // 获取单个考试信息
    static async getExamById(id: string): Promise<Exam | null> {
        await delay(50);
        return exams.find(exam => exam.id === id) || null;
    }

    // 获取考试图表数据
    static async getExamChartData(examId: string) {
        await delay(100);
        const scoreDistribution = examChartData.scoreDistributions[examId as keyof typeof examChartData.scoreDistributions] || [];
        const normalDistribution = examChartData.normalDistribution[examId as keyof typeof examChartData.normalDistribution] || [];
        const questionAccuracy = examChartData.questionAccuracy[examId as keyof typeof examChartData.questionAccuracy] || [];
        const timeDistribution = examChartData.timeDistribution[examId as keyof typeof examChartData.timeDistribution] || [];

        return {
            scoreDistribution: {
                labels: ['0-20', '21-40', '41-60', '61-80', '81-90', '91-100'],
                datasets: [{
                    label: '学生人数',
                    data: scoreDistribution,
                    backgroundColor: 'rgba(54, 162, 235, 0.6)',
                    borderColor: 'rgba(54, 162, 235, 1)',
                    borderWidth: 1
                }]
            },
            normalDistribution: {
                labels: ['45', '50', '55', '60', '65', '70', '75', '80', '85', '90', '95', '100'],
                datasets: [{
                    label: '学生人数',
                    data: normalDistribution,
                    borderColor: 'rgb(255, 99, 132)',
                    backgroundColor: 'rgba(255, 99, 132, 0.2)',
                    tension: 0.4
                }]
            },
            questionAccuracy: {
                labels: ['第1题', '第2题', '第3题', '第4题', '第5题', '第6题', '第7题', '第8题', '第9题', '第10题'],
                datasets: [{
                    label: '正确率(%)',
                    data: questionAccuracy,
                    backgroundColor: 'rgba(75, 192, 192, 0.6)',
                    borderColor: 'rgba(75, 192, 192, 1)',
                    borderWidth: 1
                }]
            },
            timeDistribution: {
                labels: ['60分钟内', '60-90分钟', '90-120分钟', '120分钟以上'],
                datasets: [{
                    data: timeDistribution,
                    backgroundColor: ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0']
                }]
            }
        };
    }

    // 获取班级列表
    static async getClasses(): Promise<ClassInfo[]> {
        await delay(100);
        return [...classes];
    }

    // 获取单个班级信息
    static async getClassById(id: string): Promise<ClassInfo | null> {
        await delay(50);
        return classes.find(cls => cls.id === id) || null;
    }

    // 获取班级图表数据
    static async getClassChartData(classId: string) {
        await delay(100);
        const scoreDistribution = classChartData.scoreDistributions[classId as keyof typeof classChartData.scoreDistributions] || [];
        const subjectScores = classChartData.subjectScores[classId as keyof typeof classChartData.subjectScores] || [];
        const activityLevels = classChartData.activityLevels[classId as keyof typeof classChartData.activityLevels] || [];
        const monthlyScores = classChartData.monthlyScores[classId as keyof typeof classChartData.monthlyScores] || [];

        return {
            scoreDistribution: {
                labels: ['60以下', '60-70', '70-80', '80-90', '90-95', '95以上'],
                datasets: [{
                    label: '学生人数',
                    data: scoreDistribution,
                    backgroundColor: 'rgba(54, 162, 235, 0.6)',
                    borderColor: 'rgba(54, 162, 235, 1)',
                    borderWidth: 1
                }]
            },
            subjectComparison: {
                labels: ['初级会计实务', '经济法基础'],
                datasets: [{
                    label: '平均分',
                    data: subjectScores,
                    borderColor: 'rgb(75, 192, 192)',
                    backgroundColor: 'rgba(75, 192, 192, 0.2)',
                    tension: 0.4
                }]
            },
            activityLevel: {
                labels: ['高活跃', '中等活跃', '低活跃'],
                datasets: [{
                    data: activityLevels,
                    backgroundColor: ['#4CAF50', '#FF9800', '#F44336']
                }]
            },
            monthlyTrend: {
                labels: ['9月', '10月', '11月', '12月', '1月', '2月'],
                datasets: [{
                    label: '月度平均分',
                    data: monthlyScores,
                    borderColor: 'rgb(255, 99, 132)',
                    backgroundColor: 'rgba(255, 99, 132, 0.2)',
                    tension: 0.4
                }]
            }
        };
    }

    // 获取学校概况数据
    static async getSchoolOverviewData() {
        await delay(150);
        return { ...schoolOverviewData };
    }
} 