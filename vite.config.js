import { defineConfig } from 'vite';

// 用相对路径引用资源：同一份构建既能放在 GitHub Pages 的子路径（/ambient-diorama/）下，
// 也能放在任意域名根目录或 iframe 里。
export default defineConfig({
  base: './',
});
