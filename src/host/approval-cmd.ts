/**
 * host/approval-cmd — 审批分档人面命令件（04 §9 定形块⑤ explain 人面 +
 * ⑥ 预设打包——2026-09-11 审批分档批 ap-3）。`/approval` TUI 命令（assembly
 * 直挂——与 /reload、/doors 同位，机制宿主有、不随插件换代卸除）。
 *
 * 四动词（无参 = status 缺省）：
 *  - `status`——当前态：sandbox 档 + 审批 policy 各自值与来源（四层解析
 *    胜者的标注面——装配根注入）+ 三档预设一览；
 *  - `entries`——策略表全列（**活体现读** tool-policy.json——与装配期快照
 *    分立；含文件路径与命中序说明：deny 命中恒最先终局、allow 取首个）；
 *  - `explain <tool> [pattern]`——真 adjudication 干跑：与守门行同一
 *    matchToolPolicy 纯函数（04 §9 ⑤定形），条目=活体现读、pattern=用户
 *    给定实参模拟；只读零副作用；
 *  - `preset <名>`——预设写盘（settings.json 两键 + tool-policy.json 建议
 *    集 append；半应用防护=坏形全拒；切换不清不删既有条目）；成功尾经
 *    onPresetApplied 落 preset/applied 审计（恰一笔——包装方 warn 不阻塞）。
 *
 * 无 CLI 入口（07 §5：CLI 面只有 `--preset <名>` 逐次旗标——逐次生效不写
 * 盘，与写盘动词生效语义分立，04 §9 ⑥ ap-3 定形补充）。
 */
import { join, resolve as resolvePath } from 'node:path';

import { canonicalPath, FS_WRITE_TOOLS, matchToolPolicy, policyHitNote } from '../safety/index.js';
import type { ToolPolicyEntry } from '../safety/index.js';
import { approvalPresetOf, APPROVAL_PRESETS, presetSuggestedEntries } from '../safety/index.js';
import type { ApprovalPresetName } from '../safety/index.js';
import type { ApprovalPolicyMode, SandboxMode } from '../safety/index.js';

import { appendToolPolicyEntry, readToolPolicy, TOOL_POLICY_BASENAME } from './tool-policy-store.js';
import { writeHostSettings } from './settings-store.js';

/** 用法说明（TUI 命令描述位 + 解析错回执共用单源） */
export const APPROVAL_USAGE = `/approval [status] | entries | explain <tool> [pattern] | preset <名>
  status                 当前态：sandbox 档 + 审批 policy（值 + 来源）+ 三档预设一览
  entries                策略表全列（活体现读 tool-policy.json——装配期快照外的当前真身）
  explain <tool> [pattern]  真裁决干跑（守门行同一 matchToolPolicy）：fs 族须带路径前缀参数、bash 须带命令原文、整名族三档并列
  preset <名>            预设写盘（conservative|balanced|open——settings.json 两键 + 建议集 append；下次启动/新装配生效）
（CLI 面无本命令——「berry-agent run --preset <名>」为逐次生效不写盘）`;

/** 子命令形（TUI parseApprovalArgv 产物——tagged union） */
export type ApprovalSub =
  | { readonly sub: 'status' }
  | { readonly sub: 'entries' }
  | { readonly sub: 'explain'; readonly tool: string; readonly pattern?: string }
  | { readonly sub: 'preset'; readonly name: string };

/** 命令结算（TUI 装配面消费 text 呈现；ok 位测试面断言用） */
export interface ApprovalCommandOutcome {
  readonly ok: boolean;
  readonly text: string;
}

/** 当前态注入面（装配根注入四层解析胜者——来源标注与值同面呈现） */
export interface ApprovalStatusFace {
  readonly mode: SandboxMode;
  readonly policy: ApprovalPolicyMode;
  /** 档位来源标注（如「CLI --read-only」/「CLI --preset open」/「settings.json」/「缺省（代码常量）」） */
  readonly modeSource: string;
  /** policy 来源标注（同上四层） */
  readonly policySource: string;
}

/** 命令面 deps（装配面注入——纯逻辑件零 fs 直连） */
export interface ApprovalCommandDeps {
  /** 数据目录（null = 纯 memory 诊断形——entries/explain 放行空面、preset 写动词拒） */
  readonly dataDir: string | null;
  /** 当前态（status 段呈现——装配根注入四层解析胜者） */
  readonly status: ApprovalStatusFace;
  /** 工作区根取值器（preset 建议集 pattern 锚点 + explain fs 族 canonical 模拟） */
  readonly workspace: () => string;
  /**
   * preset/applied 落账 seam（写盘成功尾恰一次——载荷 {preset, sandboxMode,
   * approvalPolicy, appended}；落账失败由包装方 warn 不阻塞——写盘已生效）。
   */
  readonly onPresetApplied?: (
    preset: ApprovalPresetName,
    sandboxMode: SandboxMode,
    approvalPolicy: ApprovalPolicyMode,
    appended: number,
  ) => void;
}

/**
 * TUI 面 argv 解析（零旗标面——本命令族无旗标）。无参 = status 缺省动词。
 */
export function parseApprovalArgv(
  argv: readonly string[],
): { ok: true; sub: ApprovalSub } | { ok: false; message: string } {
  const [verb, ...rest] = argv as string[];
  if (verb === undefined) return { ok: true, sub: { sub: 'status' } };
  if (verb.startsWith('--')) return { ok: false, message: `本命令族无旗标。\n${APPROVAL_USAGE}` };
  if (rest.some((tok) => tok.startsWith('--'))) return { ok: false, message: `本命令族无旗标。\n${APPROVAL_USAGE}` };
  if (verb === 'status') {
    if (rest.length > 0) return { ok: false, message: `status 不收位置参数。\n${APPROVAL_USAGE}` };
    return { ok: true, sub: { sub: 'status' } };
  }
  if (verb === 'entries') {
    if (rest.length > 0) return { ok: false, message: `entries 不收位置参数。\n${APPROVAL_USAGE}` };
    return { ok: true, sub: { sub: 'entries' } };
  }
  if (verb === 'explain') {
    if (rest.length < 1 || rest.length > 2 || (rest[0] as string) === '') {
      return {
        ok: false,
        message: `explain 须带 <tool> 一至两参（fs 族须带路径前缀、bash 须带命令原文）。\n${APPROVAL_USAGE}`,
      };
    }
    return {
      ok: true,
      sub: { sub: 'explain', tool: rest[0] as string, ...(rest[1] !== undefined ? { pattern: rest[1] } : {}) },
    };
  }
  if (verb === 'preset') {
    if (rest.length !== 1 || (rest[0] as string) === '') {
      return { ok: false, message: `preset 须带 <名> 一参数（conservative|balanced|open）。\n${APPROVAL_USAGE}` };
    }
    return { ok: true, sub: { sub: 'preset', name: rest[0] as string } };
  }
  return { ok: false, message: `未知子命令：${verb}（合法：status/entries/explain/preset）。\n${APPROVAL_USAGE}` };
}

/** 策略表条目单行渲染（entries 与 explain 命中行共用——六字段全列） */
function renderEntry(entry: ToolPolicyEntry, index: number): string {
  const bits = [`tool=${entry.tool}`];
  if (entry.pattern !== undefined) bits.push(`pattern=${entry.pattern}`);
  bits.push(`decision=${entry.decision}`);
  if (entry.effect !== undefined) bits.push(`effect=${entry.effect}`);
  if (entry.reason !== undefined) bits.push(`reason=${entry.reason}`);
  if (entry.expiresAt !== undefined) bits.push(`expiresAt=${new Date(entry.expiresAt).toISOString()}`);
  return `  [${index}] ${bits.join(' ')}`;
}

/** status 渲染（当前态两旋钮 + 来源 + 三档预设一览——纯读零副作用） */
function renderStatus(deps: ApprovalCommandDeps): ApprovalCommandOutcome {
  const lines: string[] = [];
  lines.push('当前态（四层解析胜者——工具参数 > 会话策略 > CLI 旗标 > settings.json > 代码常量）：');
  lines.push(`  sandbox 档 = ${deps.status.mode}（来源：${deps.status.modeSource}）`);
  lines.push(`  审批 policy = ${deps.status.policy}（来源：${deps.status.policySource}）`);
  lines.push(`  （本面为装配期快照——/approval entries 与 explain 现读策略表文件〔活体〕）`);
  lines.push('预设三档（preset <名> 写盘——下次启动/新装配生效，当前进程不变）：');
  for (const preset of APPROVAL_PRESETS) {
    lines.push(`  ${preset.name}: ${preset.description}`);
  }
  return { ok: true, text: lines.join('\n') };
}

/** entries 渲染（活体现读——装配期快照外的当前真身；含命中序说明） */
function renderEntries(deps: ApprovalCommandDeps): ApprovalCommandOutcome {
  if (deps.dataDir === null) {
    return { ok: true, text: '纯 memory 诊断形无数据目录——策略表缺席（空清单）。' };
  }
  const load = readToolPolicy(deps.dataDir);
  const path = join(deps.dataDir, TOOL_POLICY_BASENAME);
  if (!load.healthy) {
    return { ok: false, text: `策略表文件级坏形（${path}）——已降级视同空清单；手改修复前 preset 写动词同拒。` };
  }
  const lines: string[] = [];
  lines.push(`策略表（活体现读 ${path}——装配期载入的是启动时快照，两时点可分立）：`);
  if (load.entries.length === 0) {
    lines.push('  （空——无任何条目）');
  } else {
    load.entries.forEach((entry, index) => lines.push(renderEntry(entry, index)));
  }
  lines.push('命中序：deny 命中恒最先且终局（硬拒，任何面不可翻转）；无 deny 命中时取首个未过期 allow（免问）。');
  return { ok: true, text: lines.join('\n') };
}

/**
 * explain 干跑（04 §9 ⑤——真 adjudication 纯函数，与守门行同一
 * matchToolPolicy + policyHitNote 三面同源）：
 *  - fs 族（write/edit）：只试 write 档 + pattern 参数必填（作为写目标
 *    canonical 路径模拟——相对则锚 workspace）；
 *  - bash：只试 exec 档 + pattern 参数必填（作为命令原文——剥壳词干判定）；
 *  - 其余整名族：read/write/exec 三档并列（无实参依赖，三档各自成行）。
 * 条目 = 活体现读；只读零副作用。
 */
function renderExplain(
  sub: { readonly tool: string; readonly pattern?: string },
  deps: ApprovalCommandDeps,
): ApprovalCommandOutcome {
  if (deps.dataDir === null) {
    return { ok: true, text: '纯 memory 诊断形无数据目录——策略表缺席（空清单），无条目可判。' };
  }
  const load = readToolPolicy(deps.dataDir);
  if (!load.healthy) {
    const path = join(deps.dataDir, TOOL_POLICY_BASENAME);
    return { ok: false, text: `策略表文件级坏形（${path}）——已降级视同空清单，干跑不可判。` };
  }
  const now = Date.now();
  const workspaceRoot = deps.workspace();
  const lines: string[] = [];
  lines.push(
    `explain ${sub.tool}${sub.pattern !== undefined ? ` ${sub.pattern}` : ''}（活体干跑——条目现读 ${join(deps.dataDir, TOOL_POLICY_BASENAME)}）：`,
  );

  // fs 族：pattern 必填（写目标路径模拟——canonical 化同守门行语义）
  if (FS_WRITE_TOOLS.has(sub.tool)) {
    if (sub.pattern === undefined) {
      return {
        ok: false,
        text: `${sub.tool} 属 fs 写族——explain 须带路径前缀第二参（写目标模拟：/approval explain ${sub.tool} <路径>）。\n${APPROVAL_USAGE}`,
      };
    }
    // 相对路径锚 workspace 后 canonical 化（macOS /var 符号链→/private/var
    // 等陷阱——与守门行 extractWritePaths 产物的 canonical 绝对形同语义；
    // canonicalPath 自带父目录递归解析，不存在路径亦得稳定绝对形）
    const target = canonicalPath(resolvePath(workspaceRoot, sub.pattern));
    const hit = matchToolPolicy(
      load.entries,
      { tool: sub.tool, effect: 'write', writePaths: [target], workspace: workspaceRoot },
      now,
    );
    lines.push(
      hit === undefined
        ? `  write 档（写目标 ${target}）：无命中——照问照审（回落审批）`
        : `  write 档（写目标 ${target}）：命中 ${policyHitNote(hit)} → ${hit.entry.decision === 'deny' ? '硬拒（用户主权，任何面不可翻转）' : '免问放行（advisory——fence/可写根照走）'}`,
    );
    if (hit !== undefined) lines.push(renderEntry(hit.entry, hit.index));
    return { ok: true, text: lines.join('\n') };
  }

  // bash 族：pattern 必填（命令原文——剥壳词干判定）
  if (sub.tool === 'bash') {
    if (sub.pattern === undefined) {
      return {
        ok: false,
        text: `bash explain 须带命令原文第二参（/approval explain bash <命令>）。\n${APPROVAL_USAGE}`,
      };
    }
    const hit = matchToolPolicy(
      load.entries,
      { tool: 'bash', effect: 'exec', bashCommand: sub.pattern, workspace: workspaceRoot },
      now,
    );
    lines.push(
      hit === undefined
        ? `  exec 档（命令「${sub.pattern}」）：无命中——照问照审（回落审批）`
        : `  exec 档（命令「${sub.pattern}」）：命中 ${policyHitNote(hit)} → ${hit.entry.decision === 'deny' ? '硬拒（用户主权，任何面不可翻转）' : '免问放行（advisory——confine/沙箱面照走）'}`,
    );
    if (hit !== undefined) lines.push(renderEntry(hit.entry, hit.index));
    return { ok: true, text: lines.join('\n') };
  }

  // 整名族：三档并列（pattern 忽略——整名匹配形条目不收实参）
  if (sub.pattern !== undefined) {
    lines.push(`  （${sub.tool} 属整名族——第二参忽略〔条目命中不依赖调用实参〕）`);
  }
  let any = false;
  for (const effect of ['read', 'write', 'exec'] as const) {
    const hit = matchToolPolicy(load.entries, { tool: sub.tool, effect, workspace: workspaceRoot }, now);
    if (hit === undefined) {
      lines.push(`  ${effect} 档：无命中`);
      continue;
    }
    any = true;
    lines.push(
      `  ${effect} 档：命中 ${policyHitNote(hit)} → ${hit.entry.decision === 'deny' ? '硬拒（用户主权，任何面不可翻转）' : '免问放行（advisory）'}`,
    );
    lines.push(renderEntry(hit.entry, hit.index));
  }
  if (!any) lines.push('  （无任何命中——该工具照问照审）');
  return { ok: true, text: lines.join('\n') };
}

/**
 * preset 写盘（04 §9 ⑥——展开式非引用式；序 = 预设名解析 → 策略表健康前置
 * 〔半应用防护：坏形全拒，settings 不写〕 → settings.json 两键合并写 →
 * 建议集逐条经写侧唯一正门 append〔幂等去重〕 → 审计恰一笔 → 诚实回执）。
 */
function runPreset(name: string, deps: ApprovalCommandDeps): ApprovalCommandOutcome {
  const preset = approvalPresetOf(name);
  if (preset === undefined) {
    return {
      ok: false,
      text: `未知预设名：${name}（合法：${APPROVAL_PRESETS.map((p) => p.name).join('|')}）。\n${APPROVAL_USAGE}`,
    };
  }
  if (deps.dataDir === null) {
    return { ok: false, text: '纯 memory 诊断形无数据目录——preset 写动词不可用（无落点）。' };
  }
  // 半应用防护第一闸：策略表坏形期全拒（档位与条目两文件原子性不可得，宁全
  // 拒不留半应用态——04 §9 ⑥ ap-3 定形补充）
  const load = readToolPolicy(deps.dataDir);
  if (!load.healthy) {
    return {
      ok: false,
      text: `策略表文件级坏形（${join(deps.dataDir, TOOL_POLICY_BASENAME)}）——preset 全拒（防半应用态：不写 settings.json 亦不 append 条目）；手改修复后重试。`,
    };
  }
  // 两旋钮合并写（保留未知键——用户手编面不因预设切换损毁）
  const write = writeHostSettings(deps.dataDir, {
    sandboxMode: preset.sandboxMode,
    approvalPolicy: preset.approvalPolicy,
  });
  if (write === 'rejected') {
    return { ok: false, text: 'settings.json 坏形期拒写——preset 全败（手改修复后重试）。' };
  }
  // 建议集展开 append（写侧唯一正门——幂等去重；conservative/balanced 空集零写入）
  const drafts = presetSuggestedEntries(preset.name, deps.workspace());
  let appended = 0;
  for (const draft of drafts) {
    const result = appendToolPolicyEntry(deps.dataDir, draft);
    if (result === 'appended') appended += 1;
    if (result === 'rejected') {
      return {
        ok: false,
        text: `条目追加被拒（策略表坏形期拒写）——settings.json 两键已写（${preset.sandboxMode}/${preset.approvalPolicy}）、条目追加 ${appended} 条后中止；手改修复 tool-policy.json 后重试补齐。`,
      };
    }
  }
  // 审计恰一笔（成功尾——包装方 warn 不阻塞）
  deps.onPresetApplied?.(preset.name, preset.sandboxMode, preset.approvalPolicy, appended);
  const lines: string[] = [];
  lines.push(`已切换预设：${preset.name}——${preset.description}`);
  lines.push(
    `  settings.json ← sandboxMode=${preset.sandboxMode} + approvalPolicy=${preset.approvalPolicy}（合并写，未知键保留）`,
  );
  lines.push(
    appended > 0
      ? `  tool-policy.json ← 建议集追加 ${appended} 条（幂等去重——重复条目不二写）`
      : '  tool-policy.json ← 建议集空，零写入',
  );
  lines.push('  切换不清不删既有条目（含从 open 切回——撤除建议条目归手删）；既有会话粘性与在身审批不受影响。');
  lines.push(
    '生效时点（诚实）：sandbox 档与策略表均装配期快照——当前进程不变，下次启动/新装配生效；/approval entries 与 explain 现读文件（活体）即时可见。',
  );
  return { ok: true, text: lines.join('\n') };
}

/** `/approval` 命令面主入口（sub → 结算形；写动词失败零审计） */
export function runApprovalCommand(sub: ApprovalSub, deps: ApprovalCommandDeps): ApprovalCommandOutcome {
  switch (sub.sub) {
    case 'status':
      return renderStatus(deps);
    case 'entries':
      return renderEntries(deps);
    case 'explain':
      return renderExplain(sub, deps);
    case 'preset':
      return runPreset(sub.name, deps);
  }
}
