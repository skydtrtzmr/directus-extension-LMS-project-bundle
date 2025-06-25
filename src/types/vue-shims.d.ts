declare module '*.vue' {
    import type { DefineComponent } from 'vue';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/ban-types
    const component: DefineComponent<{}, {}, any>;
    export default component;
}

// 为 Directus 扩展添加全局类型声明
declare global {
    interface Window {
        __VUE_DEVTOOLS_GLOBAL_HOOK__?: any;
    }
} 