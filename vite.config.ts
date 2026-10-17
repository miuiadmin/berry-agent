import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

/**
 * vite 构建配置（批 18a-2；07 §4.2 栈钉定——React + Vite + Tailwind）。
 *
 * 根 = src/webui/client（SPA 源面独立成树）；产物 = dist/webui/——
 * createWebuiServer staticDir 的装载位（SPA fallback index.html 由
 * 服务端静态面腿兜底）。构建走 `npm run build:webui`（与 tsc 主构建
 * 分立——SPA 自成产物链，互不收编）。
 */
export default defineConfig({
  root: 'src/webui/client',
  plugins: [react(), tailwindcss()],
  build: {
    // outDir 相对 root（src/webui/client）——回仓顶 dist/src/webui（三级
    // 上翻 + 入 dist：client → webui → src → 仓顶，再下探 dist/src/webui；
    // 07 §2.3 钉定位）。dist/src
    // 前缀 = 2026-10-17 ④试点件迁移落码批 rootDir 仓根化（tsconfig.build
    // rootDir "." → 产物 dist/src/** + dist/plugins/** 双区布局；服务端
    // dist/src/webui/*.js 与本 SPA dist/src/webui/index.html+assets 同目录
    // 共生——文件名不相撞）。emptyOutDir 只许在 build 链首位跑——npm run
    // build 已序制为 build:webui → tsc → emit-api-decls（后写者不被清）。
    outDir: '../../../dist/src/webui',
    emptyOutDir: true,
  },
});
