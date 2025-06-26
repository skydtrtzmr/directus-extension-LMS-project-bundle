// 学科数据
export interface Subject {
    id: string;
    name: string;
    icon: string;
    studentCount: number;
    teacherCount: number;
    courseCount: number;
    averageScore: number;
}

export const subjects: Subject[] = [
    {
        id: 'accounting_practice',
        name: '初级会计实务',
        icon: 'calculate',
        studentCount: 856,
        teacherCount: 15,
        courseCount: 22,
        averageScore: 78.5
    },
    {
        id: 'economic_law',
        name: '经济法基础',
        icon: 'gavel',
        studentCount: 834,
        teacherCount: 12,
        courseCount: 18,
        averageScore: 81.2
    }
];

// 考试数据
export interface Exam {
    id: string;
    name: string;
    date: string;
    participantCount: number;
    averageScore: number;
    passRate: number;
    avgDuration: number;
}

export const exams: Exam[] = [
    {
        id: 'exam_2024_01',
        name: '2024年初级会计职称考试',
        date: '2024-05-15',
        participantCount: 1156,
        averageScore: 82.5,
        passRate: 87.3,
        avgDuration: 95
    },
    {
        id: 'exam_2023_12',
        name: '2023年初级会计职称考试',
        date: '2023-05-20',
        participantCount: 1089,
        averageScore: 79.8,
        passRate: 84.6,
        avgDuration: 102
    },
    {
        id: 'exam_2023_06',
        name: '2023年初级会计模拟考试',
        date: '2023-03-18',
        participantCount: 845,
        averageScore: 75.2,
        passRate: 78.9,
        avgDuration: 88
    },
    {
        id: 'exam_2022_12',
        name: '2022年初级会计职称考试',
        date: '2022-05-10',
        participantCount: 998,
        averageScore: 76.4,
        passRate: 79.1,
        avgDuration: 92
    }
];

// 班级数据
export interface ClassInfo {
    id: string;
    name: string;
    grade: string;
    studentCount: number;
    averageScore: number;
    attendanceRate: number;
    ranking: number;
}

export const classes: ClassInfo[] = [
    {
        id: 'class_2024_1',
        name: '会计1班',
        grade: '2024级',
        studentCount: 45,
        averageScore: 87.5,
        attendanceRate: 96.8,
        ranking: 1
    },
    {
        id: 'class_2024_2',
        name: '会计2班',
        grade: '2024级',
        studentCount: 43,
        averageScore: 85.2,
        attendanceRate: 94.5,
        ranking: 3
    },
    {
        id: 'class_2023_1',
        name: '会计3班',
        grade: '2023级',
        studentCount: 48,
        averageScore: 83.8,
        attendanceRate: 95.2,
        ranking: 5
    },
    {
        id: 'class_2023_2',
        name: '会计4班',
        grade: '2023级',
        studentCount: 46,
        averageScore: 86.1,
        attendanceRate: 97.1,
        ranking: 2
    },
    {
        id: 'class_2022_1',
        name: '会计5班',
        grade: '2022级',
        studentCount: 42,
        averageScore: 82.4,
        attendanceRate: 93.8,
        ranking: 6
    }
];

// 学科相关图表数据
export const subjectChartData = {
    scoreData: {
        accounting_practice: [75, 78, 76, 82, 79, 81],
        economic_law: [79, 82, 80, 85, 83, 84]
    },
    difficultyData: {
        accounting_practice: [25, 45, 25, 5], // 简单、中等、困难、极难
        economic_law: [30, 40, 25, 5]
    },
    studyTimeData: {
        accounting_practice: [65, 158, 234, 156, 43],
        economic_law: [78, 145, 198, 123, 35]
    },
    knowledgePointData: {
        accounting_practice: {
            labels: ['会计基础', '资产核算', '负债核算', '所有者权益', '收入费用利润'],
            scores: [88, 82, 75, 85, 79]
        },
        economic_law: {
            labels: ['法律基础', '会计法律制度', '支付结算法律制度', '增值税法律制度', '企业所得税法律制度'],
            scores: [85, 88, 82, 78, 80]
        }
    }
};

// 考试相关图表数据
export const examChartData = {
    scoreDistributions: {
        'exam_2024_01': [23, 89, 234, 389, 278, 143],
        'exam_2023_12': [34, 98, 245, 356, 234, 122],
        'exam_2023_06': [45, 112, 198, 278, 167, 45],
        'exam_2022_12': [52, 125, 223, 298, 189, 51]
    },
    normalDistribution: {
        'exam_2024_01': [5, 12, 28, 45, 78, 125, 189, 234, 198, 145, 78, 19],
        'exam_2023_12': [8, 18, 34, 56, 89, 134, 198, 245, 178, 98, 45, 12],
        'exam_2023_06': [12, 25, 45, 67, 98, 156, 187, 234, 156, 89, 34, 8],
        'exam_2022_12': [15, 28, 48, 72, 105, 165, 195, 245, 165, 95, 42, 12]
    },
    questionAccuracy: {
        'exam_2024_01': [92, 87, 83, 78, 74, 69, 65, 58, 52, 45],
        'exam_2023_12': [88, 84, 79, 75, 71, 66, 62, 55, 48, 41],
        'exam_2023_06': [85, 82, 76, 72, 68, 63, 59, 52, 45, 38],
        'exam_2022_12': [83, 80, 74, 70, 66, 61, 57, 50, 43, 36]
    },
    timeDistribution: {
        'exam_2024_01': [145, 567, 334, 110],
        'exam_2023_12': [123, 489, 378, 99],
        'exam_2023_06': [98, 445, 256, 46],
        'exam_2022_12': [89, 398, 298, 65]
    }
};

// 班级相关图表数据
export const classChartData = {
    scoreDistributions: {
        'class_2024_1': [2, 5, 8, 15, 12, 3],
        'class_2024_2': [3, 6, 9, 12, 10, 3],
        'class_2023_1': [4, 8, 12, 14, 8, 2],
        'class_2023_2': [2, 4, 10, 16, 11, 3],
        'class_2022_1': [5, 9, 14, 12, 8, 2]
    },
    subjectScores: {
        'class_2024_1': [87, 89], // 初级会计实务, 经济法基础
        'class_2024_2': [84, 86],
        'class_2023_1': [82, 84],
        'class_2023_2': [85, 87],
        'class_2022_1': [80, 82]
    },
    activityLevels: {
        'class_2024_1': [28, 12, 5],
        'class_2024_2': [25, 13, 5],
        'class_2023_1': [26, 15, 7],
        'class_2023_2': [30, 11, 5],
        'class_2022_1': [22, 15, 5]
    },
    monthlyScores: {
        'class_2024_1': [85, 86, 87, 88, 87, 89],
        'class_2024_2': [83, 84, 85, 85, 84, 86],
        'class_2023_1': [81, 82, 83, 84, 83, 85],
        'class_2023_2': [84, 85, 86, 87, 86, 88],
        'class_2022_1': [78, 79, 80, 81, 80, 82]
    }
};

// 学校概况数据
export const schoolOverviewData = {
    totalUsers: 1248,
    totalStudents: 956,
    totalTeachers: 45,
    totalCourses: 28,
    activityData: {
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
    },
    courseDistributionData: {
        labels: ['初级会计实务', '经济法基础', '实训课程', '职业规划', '其他'],
        datasets: [{
            data: [35, 30, 20, 10, 5],
            backgroundColor: [
                '#FF6384',
                '#36A2EB',
                '#FFCE56',
                '#4BC0C0',
                '#FF9F40'
            ]
        }]
    },
    gradeDistributionData: {
        labels: ['90-100', '80-89', '70-79', '60-69', '60以下'],
        datasets: [{
            label: '学生人数',
            data: [156, 298, 234, 167, 89],
            backgroundColor: 'rgba(54, 162, 235, 0.6)',
            borderColor: 'rgba(54, 162, 235, 1)',
            borderWidth: 1
        }]
    },
    registrationData: {
        labels: ['7月', '8月', '9月', '10月', '11月', '12月'],
        datasets: [{
            label: '新注册用户',
            data: [45, 67, 123, 89, 76, 98],
            borderColor: 'rgb(153, 102, 255)',
            backgroundColor: 'rgba(153, 102, 255, 0.2)',
            tension: 0.4
        }]
    }
}; 