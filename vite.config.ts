import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

/**
 * vite 构建配置（批 18a-2；07 §4.2 栈钉定——React + Vite + Tailwind）。
 *
 * 根 = plugins/webui/client（SPA 源面独立成树——2026-10-17 ④批量迁移 D 腿
 * 随 webui 件迁 plugins/）；产物 = dist/plugins/webui/——
 * createWebuiServer staticDir 的装载位（SPA fallback index.html 由
 * 服务端静态面腿兜底）。构建走 `npm run build:webui`（与 tsc 主构建
 * 分立——SPA 自成产物链，互不收编）。
 */
export default defineConfig({
  root: 'plugins/webui/client',
  plugins: [react(), tailwindcss()],
  build: {
    // outDir 相对 root（plugins/webui/client）——回仓顶 dist/plugins/webui
    // （三级上翻 + 入 dist：client → webui → plugins → 仓顶，再下探
    // dist/plugins/webui；07 §2.3 钉定位——④批量迁移 D 腿 webui 挪区后
    // src 段换 plugins 段、上探层级数不变〔三级〕、下探段随双区布局改
    // dist/plugins/webui）。dist/plugins 前缀 = 2026-10-17 ④试点件迁移
    // 落码批 rootDir 仓根化（tsconfig.build rootDir "." → 产物 dist/src/**
    // + dist/plugins/** 双区布局；服务端 dist/plugins/webui/*.js 与本 SPA
    // dist/plugins/webui/index.html+assets 同目录共生——文件名不相撞）。
    // emptyOutDir 只许在 build 链首位跑——npm run build 已序制为
    // build:webui → tsc → emit-api-decls（后写者不被清）。
    outDir: '../../../dist/plugins/webui',
    emptyOutDir: true,
  },
});
