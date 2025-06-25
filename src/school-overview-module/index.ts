import { defineModule } from '@directus/extensions-sdk';
import ModuleComponent from './module.vue';

export default defineModule({
    id: 'school-overview',
    name: '学校概况',
    icon: 'school',
    routes: [
        {
            path: '',
            component: ModuleComponent,
        },
    ],
}); 