/**
 * 工具面用户话术单源（07 §4.1 V-0 注⑤错误呈现律——工具调用用户面呈现中文化）。
 *
 * 射界（V-0 注⑤射界注）：内建族**动词位/工具名映射位/参数签名键位**——裸签名
 * 形 `agent(name, prompt)` 禁；exec 卡头动词 `Ran` 维持例外不动（2026-09-30
 * 用户拍板复刻位）；无映射工具（插件/未来内建）英文直呈兜底不虚译。
 *
 * **分层律**：转写只发生在呈现层（渲染位/简述构造位）——数据面块字段与事件
 * 载荷保原始名：exec 卡族判断（card.name === 'bash'）与插件渲染腿查表
 * （lookupToolRenderer）均依赖原始工具名，数据面改名即断两链。
 *
 * 居位（2026-10-02 TUI 视觉重设计批 V-2 笔 1 迁入，原居 channels/tui）：
 * channels（TUI）与 webui 客户端（SPA——channels 公开面桶经 theme/custom 拉
 * node:fs，DOM 类型面与浏览器包不可承）跨通道两方消费，零依赖纯件入
 * contracts 公开根（durations 同律）。
 */

/** 内建工具族动词映射（英文名 → 用户面动词） */
const TOOL_FACE_ZH: ReadonlyMap<string, string> = new Map([
  ['agent', '子代理'],
  ['write', '写入文件'],
  ['edit', '编辑文件'],
  ['read', '读取文件'],
  ['ls', '列目录'],
  ['find', '查找文件'],
  ['grep', '搜索文本'],
]);

/**
 * 工具名用户面动词（V-0 注⑤）：映射集内译、集外英文直呈（插件工具不虚译——
 * 注册名即用户可引用名）。
 */
export function toolFaceZh(name: string): string {
  return TOOL_FACE_ZH.get(name) ?? name;
}

/**
 * 工具执行语义记形（⚙——07 §4.1 R4「孤儿调用兜底 ⚙ 简行」族）：工具卡头/
 * 状态行/简行跨通道统一 glyph 单源。2026-10-04 收编：原单源位 panel-chrome
 * HEAD_MARKS.tool（tui 域）扩域到 webui SPA（DOM 类型面不可拉 tui 图——
 * toolFaceZh 同律入 contracts），HEAD_MARKS.tool 改委派本源、consumers
 * （transcript 孤儿兜底简行 / webui frames 状态与终结行三位）全走本源。
 */
export const TOOL_RUN_MARK = '⚙';

/** 参数签名键位映射（argsBrief 白名单族键名 → 人读键位） */
const ARG_KEY_ZH: ReadonlyMap<string, string> = new Map([
  ['prompt', '任务'],
  ['command', '命令'],
  ['path', '路径'],
  ['pattern', '模式'],
  ['file', '文件'],
  ['background', '后台'],
]);

/** 参数键用户面键位（V-0 注⑤参数签名键位）：白名单族译、集外键名直呈。 */
export function argKeyZh(key: string): string {
  return ARG_KEY_ZH.get(key) ?? key;
}
