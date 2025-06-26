import { defineModule } from '@directus/extensions-sdk';
import ModuleComponent from './views/ModuleView.vue';
import OverviewPage from './views/OverviewPage.vue';
import SubjectAnalysisPage from './views/SubjectAnalysisPage.vue';
import ExamAnalysisPage from './views/ExamAnalysisPage.vue';
import ClassAnalysisPage from './views/ClassAnalysisPage.vue';

export default defineModule({
    id: 'school-overview',
    name: '统计分析',
    icon: 'analytics',
    routes: [
        {
            path: '',
            component: ModuleComponent,
            children: [
                {
                    path: '',
                    redirect: '/school-overview/overview',
                },
                {
                    path: 'overview',
                    component: OverviewPage,
                },
                {
                    path: 'subjects',
                    component: SubjectAnalysisPage,
                },
                {
                    path: 'exams',
                    component: ExamAnalysisPage,
                },
                {
                    path: 'classes',
                    component: ClassAnalysisPage,
                },
            ],
        },
    ],
}); 