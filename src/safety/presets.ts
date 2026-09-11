/**
 * L3 safety — 权限预设打包（04 §9 定形块⑥·RP5——纯数据半边，2026-09-11
 * 审批分档批 ap-3）。
 *
 * 预设 = sandbox 档 × 审批 policy × 策略表建议集的**打包缺省**，三档定名：
 * - `conservative`：read-only + ask + 空建议集；
 * - `balanced`：workspace-write + ask + 空建议集——**缺省档 = 现状打包**，零行为变化；
 * - `open`：workspace-write + ask + 建议集 = 工作区根 fs 写前缀两件 +
 *   git 本地只读词干五件（04 §8 GIT_METADATA_COMMANDS 闭集取本地只读子集
 *   ——**push/pull/fetch 网络族不入集**：§13「此类词干不经 allowlist 放行」
 *   不因预设翻转，git push 恒走危险闸〔冷读闸 M5 定形〕）。
 *
 * 展开式非引用式（不留预设名第二真相源）：本件只产**展开值**——两旋钮
 * （sandboxMode/approvalPolicy）与 allow 草案清单；草案经写侧唯一正门
 * `appendToolPolicyEntry` 落盘（host 消费腿），机器条目无 reason/effect/
 * expiresAt（与审批服务 suggestedEntry 同形——ToolPolicyDraft 两字段）。
 * 无静默审批不破：open 档不含任何 yolo 形自动放行——policy 闭集 ask/never
 * 本就无「不问放行」档，预设只打包既有合法态组合。
 */

import type { ToolPolicyDraft } from './types.js';
import type { ApprovalPolicyMode, SandboxMode } from './types.js';

/** 预设名闭集（三档——04 §9 ⑥定名；CLI --preset 值域同源本表） */
export const APPROVAL_PRESET_NAMES = ['conservative', 'balanced', 'open'] as const;
export type ApprovalPresetName = (typeof APPROVAL_PRESET_NAMES)[number];

/** 预设展开形（两旋钮 + 描述——建议集独立函数产，见 presetSuggestedEntries） */
export interface ApprovalPreset {
  readonly name: ApprovalPresetName;
  readonly sandboxMode: SandboxMode;
  readonly approvalPolicy: ApprovalPolicyMode;
  /** 人面呈现用中文描述（/approval 回执与 --preset 帮助面） */
  readonly description: string;
}

/**
 * 三档打包表（静态单源）。balanced = 现状（workspace-write + ask）零变化；
 * conservative 只收紧沙箱档（policy 仍 ask——never 档缺省不给：无人应答
 * fail-closed 已是缺省语义，无需用户选「直接拒」档防身）。
 */
export const APPROVAL_PRESETS: readonly ApprovalPreset[] = [
  {
    name: 'conservative',
    sandboxMode: 'read-only',
    approvalPolicy: 'ask',
    description: '只读沙箱——文件写/执行全走审批（最严档）',
  },
  {
    name: 'balanced',
    sandboxMode: 'workspace-write',
    approvalPolicy: 'ask',
    description: '工作区可写 + 审批如常（缺省档 = 现状打包，零行为变化）',
  },
  {
    name: 'open',
    sandboxMode: 'workspace-write',
    approvalPolicy: 'ask',
    description: '工作区可写 + fs 写与 git 本地只读命令免问建议集（不含网络写动词族）',
  },
];

/** 取预设（未知名返 undefined——调用方自定错误面，本件不抛） */
export function approvalPresetOf(name: string): ApprovalPreset | undefined {
  return APPROVAL_PRESETS.find((preset) => preset.name === name);
}

/**
 * open 档 bash 建议词干五件（04 §8 GIT_METADATA_COMMANDS 本地只读子集——
 * 网络写动词 push/pull/fetch 恒不入集，见文件头注）。
 */
const OPEN_GIT_STEMS: readonly string[] = ['git status', 'git log', 'git diff', 'git show', 'git branch'];

/**
 * 预设建议集展开（写盘腿专用——CLI 逐次形不产条目，04 §9 ⑥ ap-3 定形补充）：
 * - conservative/balanced：空清单（建议集为空零写入——切档不清不删既有条目）；
 * - open：fs 两件（write/edit × 工作区根前缀）+ bash 五词干，共七条 allow 草案。
 * pattern = 工作区根 canonical 绝对路径（fs 前缀语义）或命令词干（bash 语义）
 * ——与审批服务 suggestedEntry 同源同形（ToolPolicyDraft 两字段），机器条目
 * 无 reason/effect/expiresAt。
 */
export function presetSuggestedEntries(preset: ApprovalPresetName, workspaceRoot: string): readonly ToolPolicyDraft[] {
  if (preset !== 'open') return [];
  const root = workspaceRoot.length > 0 ? workspaceRoot : '.';
  return [
    { tool: 'write', pattern: root },
    { tool: 'edit', pattern: root },
    ...OPEN_GIT_STEMS.map((stem) => ({ tool: 'bash', pattern: stem })),
  ];
}
