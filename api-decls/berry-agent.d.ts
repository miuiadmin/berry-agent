/**
 * 虚拟模块 `berry-agent` 的类型面（API 治理公开面第一键——宿主公开根）。
 *
 * 内容恒为一行再导出——真身在 dist/contracts/*.d.ts（tsconfig.api.json 声明
 * 发射产物，公开根 src/contracts/index.ts 传递闭包）。插件侧 tsconfig paths
 * 把 `berry-agent` 映到本文件（模板见同目录 tsconfig.paths.json）——插件
 * 作者 tsc 可解析虚拟键，类型面不靠运行时注入后猜。
 */
export * from '../contracts/index.js';
