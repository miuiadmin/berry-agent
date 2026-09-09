/**
 * host/doors-cmd — 开门制人面命令件（03 §4.6 `/doors` 人面命令 =
 * enabled.yaml doors 段的编辑腿；07 §5 定名行——开门制扩展批 g-2 落码）。
 *
 * 双面分立（有意偏离 /credentials 双面族形——07 §5 定名：**写动词 TUI
 * 单面**，headless 场景经文件直编 doors 段、boot diff 记账覆盖〔origin
 * 'boot-diff'〕）：
 *  - **TUI 面**（assembly 直挂——与 /reload、/plugins 同位，机制宿主有、
 *    不随插件换代卸除）：三动词全量——list 只读 + open/close 写动词（写回
 *    段 + 落 `doors/updated` origin 'tui-cmd' + 生效时点诚实回执）；
 *  - **CLI 面**（`berry-agent doors <sub>`——runDoorsEntry）：list 只读
 *    受理；open/close **语义拒退 1**（合法解析形非用法错——解析层照常受理，
 *    执行层诚实指路文件直编）。零装配零库纯文件读（不 boot 插件面、不开
 *    Persistence——段在文件不在库）。
 *
 * list 呈现 = 六枚高危面全清单（USER_GRANTABLE_CAPABILITIES 单源）+ 当前
 * 开态**双源呈现**：行 opens 按插件分组 + doors 段进程级一行；闭门 reason
 * = adjudicateCapabilityDoor 单源 message（与 session_status 门态段、执行
 * 时拒绝同源——先查后用）。
 *
 * 生效时点诚实律：g-1 门检输入 = 活体源（受理时点现读现判——open/close 写
 * 回即门立即生效、撤位即收回）；装载面（boot 快照/审计基线）下次 /reload
 * 或启动刷新。回执两时点都陈述。
 */
import { stdout as processStdout, stderr as processStderr } from 'node:process';

import { resolveDataDir } from '../persist/index.js';
import { adjudicateCapabilityDoor, DOORS_SEGMENT_V1_DOMAIN, USER_GRANTABLE_CAPABILITIES } from '../contracts/api.js';

import { createPluginStoreFs, editDoorsSegment, readEnabledRowsForEdit } from './plugin-store.js';
import type { PluginStoreFs } from './plugin-store.js';

/** 用法说明（TUI 命令描述位 + 解析错回执共用单源） */
export const DOORS_USAGE = `/doors list | open <capability> | close <capability>
  list                 六枚高危面全清单 + 当前开态双源呈现（行 opens 按插件分组 + doors 段进程级一行）
  open <capability>    开门（写回 enabled.yaml doors 段 + 落 doors/updated——门检即时生效）
  close <capability>   关门（撤位即收回；doors 段收口为显式空段）
（CLI 面只读 list——写动词 TUI 专属；headless 经文件直编 doors 段 + boot diff 记账）`;

/**
 * 子命令形（TUI parseDoorsArgv 产物 = CLI cli.ts 解析产物——两面同一
 * tagged union，动词语义单源在 runDoorsCommand；credentials/commands 同款）。
 */
export type DoorsSub =
  | { readonly sub: 'list' }
  | { readonly sub: 'open'; readonly door: string }
  | { readonly sub: 'close'; readonly door: string };

/** 命令结算（ok 位供 CLI 退出码分档〔0/1〕；TUI 装配面只消费 text） */
export interface DoorsCommandOutcome {
  readonly ok: boolean;
  readonly text: string;
}

/** 命令面 deps（装配面注入——纯逻辑件零 fs/db 直连；CLI 面零落账缺省） */
export interface DoorsCommandDeps {
  /** 数据目录（null = 纯 memory 诊断形——写动词拒、list 放行——/plugins 同律） */
  readonly dataDir: string | null;
  /** 段编辑文件面（plugin-store 同源——与 CLI 同一 fs 词形） */
  readonly fs: PluginStoreFs;
  /**
   * doors/updated 落账 seam（成功真变更尾恰一次——载荷排序快照，origin
   * 'tui-cmd' 由装配位盖章；落账失败由包装方 warn 不阻塞——段编辑已生效）。
   * CLI 面无此腿（写动词语义拒——永不触达）。
   */
  readonly onDoorsUpdated?: (doors: readonly string[]) => void;
}

/**
 * TUI 面 argv 解析（CLI 面由 cli.ts 解析律执法——未知旗标退 2 等；本函数
 * 只服务 TUI 通道的裸 argv：动词识别 + 位置参数，零旗标面）。
 */
export function parseDoorsArgv(argv: readonly string[]): { ok: true; sub: DoorsSub } | { ok: false; message: string } {
  const [verb, ...rest] = argv as string[];
  if (verb === undefined || verb.startsWith('--')) {
    return { ok: false, message: `缺子命令。\n${DOORS_USAGE}` };
  }
  if (rest.some((tok) => tok.startsWith('--'))) {
    return { ok: false, message: `本命令族无旗标。\n${DOORS_USAGE}` };
  }
  if (verb === 'list') {
    if (rest.length > 0) return { ok: false, message: `list 不收位置参数。\n${DOORS_USAGE}` };
    return { ok: true, sub: { sub: 'list' } };
  }
  if (verb === 'open' || verb === 'close') {
    if (rest.length !== 1 || (rest[0] as string) === '') {
      return { ok: false, message: `${verb} 须带 <capability> 一参数。\n${DOORS_USAGE}` };
    }
    return { ok: true, sub: { sub: verb, door: rest[0] as string } };
  }
  return { ok: false, message: `未知子命令：${verb}（合法：list/open/close）。\n${DOORS_USAGE}` };
}

/**
 * list 渲染（六枚全清单 + 双源呈现——纯读零副作用）：
 *  - 清单段：每枚高危面标注开态——doors 段含（进程级）/ 启用行 opens 含
 *    （插件道：插件 id 清单）/ 闭门附 adjudicateCapabilityDoor 单源 reason
 *    （与 session_status 门态段、执行时拒绝 message 同源）；
 *  - 双源段：行 opens 按插件分组（disabled 行标注——授予面在场但实效收回）
 *    + doors 段进程级一行（缺席 = 空集诚实呈现）。
 */
function renderDoorsList(dataDir: string | null, fs: PluginStoreFs): DoorsCommandOutcome {
  const read = readEnabledRowsForEdit(dataDir ?? '', fs);
  if (!read.ok) return { ok: false, text: read.message };
  const doors = new Set(read.doors ?? []);
  // 行 opens 分组（带 opens 的行全列——disabled 行授予面在场但装载侧实效
  // 收回〔readTriggerOpensLive 判 disabled → 空集〕，标注呈现不隐藏）
  const rowLines: string[] = [];
  for (const row of read.rows) {
    if (row.opens === undefined || row.opens.length === 0) continue;
    rowLines.push(
      `    ${row.id}: ${[...row.opens].join('、')}${row.disabled === true ? '（已禁用——授予实效收回）' : ''}`,
    );
  }
  const lines: string[] = [];
  lines.push(`高危面清单（${USER_GRANTABLE_CAPABILITIES.length} 枚——闭门附 adjudicateCapabilityDoor 同源 reason）：`);
  for (const capability of USER_GRANTABLE_CAPABILITIES) {
    const openers = read.rows
      .filter((row) => row.disabled !== true && (row.opens ?? []).includes(capability))
      .map((r) => r.id);
    // 闭门 reason = 单源 verdict.message（六枚皆高危面，空集判恒 door-closed
    // 非 not-a-door——窄化兜底只为类型面，语义上不可达）
    const closed = adjudicateCapabilityDoor(new Set<string>(), capability);
    const state = doors.has(capability)
      ? `open（doors 段——进程级）`
      : openers.length > 0
        ? `open（行 opens：${openers.join('、')}）`
        : `closed——${closed.ok ? '未开门' : closed.message}`;
    lines.push(`  ${capability}=${state}`);
  }
  lines.push('授予双源（03 §4.6——两源任一含即门开；受理时点现读现判，撤位即收回）：');
  lines.push('  行 opens（插件道——授予跟插件 id 走，换装零继承）：');
  lines.push(...(rowLines.length > 0 ? rowLines : ['    （无——未有任何插件行开位）']));
  lines.push('  doors 段（进程级——模型道两门值域，/doors open|close 编辑对象）：');
  lines.push(
    doors.size > 0
      ? `    ${[...doors].sort().join('、')}`
      : read.doors === undefined
        ? '    （段缺席 = 空集）'
        : '    （显式空段 = 空集）',
  );
  return { ok: true, text: lines.join('\n') };
}

/**
 * `/doors` 命令面主入口（sub → 结算形）。写动词失败零副作用（值域拒/文件
 * 面 refusal 不落账）；成功尾序 = 段写回 → doors/updated 落账 → 生效时点
 * 诚实回执（门检即时生效——g-1 活体源；装载面 /reload 或下次启动刷新）。
 */
export function runDoorsCommand(sub: DoorsSub, deps: DoorsCommandDeps): DoorsCommandOutcome {
  if (sub.sub === 'list') {
    return renderDoorsList(deps.dataDir, deps.fs);
  }
  if (deps.dataDir === null) {
    return { ok: false, text: '纯 memory 诊断形无数据目录——写动词不可用（doors 段编辑无落点）' };
  }
  const result = editDoorsSegment(deps.dataDir, { verb: sub.sub, door: sub.door }, deps.fs, deps.onDoorsUpdated);
  if (!result.ok) return { ok: false, text: result.message };
  const tail = '门检即时生效（受理时点现读现判）；装载面（boot 快照/审计基线）下次 /reload 或启动刷新';
  return {
    ok: true,
    text:
      sub.sub === 'open'
        ? `已开门：${sub.door}——写回 enabled.yaml doors 段。${tail}`
        : `已关门：${sub.door}——doors 段撤位（收口为空时写回显式空段）。${tail}`,
  };
}

/** CLI 入口选项（main 分派接线 + 测试注入面） */
export interface DoorsEntryOptions {
  /** 数据目录（缺省 resolveDataDir()——enabled.yaml 归属地；不开库——段在文件） */
  readonly dataDir?: string;
  /** 输出面（缺省 process.stdout——测试注入） */
  readonly writeOut?: (text: string) => void;
  /** 错误面（缺省 process.stderr——测试注入） */
  readonly writeErr?: (text: string) => void;
}

/**
 * `berry-agent doors <sub>` CLI 入口（07 §5 定名——list 只读 v1 进、写动词
 * 语义拒）。零装配零库纯文件读：不开运行时、不占单活跃机标记、不 boot
 * 插件面、不开 Persistence（与 credentials-cmd 直开库分立点——doors 真源
 * 恒文件）。退出码：0 成功（含空集诚实呈现）/ 1 执行失败或写动词语义拒 /
 * 用法错归解析层退 2。
 */
export async function runDoorsEntry(sub: DoorsSub, options: DoorsEntryOptions): Promise<number> {
  const out = options.writeOut ?? ((text) => processStdout.write(`${text}\n`));
  const err = options.writeErr ?? ((text) => processStderr.write(`${text}\n`));
  if (sub.sub !== 'list') {
    // 写动词 TUI 专属（07 §5 定名——有意偏离双面族形）：合法解析形非用法
    // 错，执行层诚实指路（headless 正路 = 文件直编 + boot diff 记账覆盖）
    out(
      `doors ${sub.sub} 为 TUI /doors 专属动词——CLI 面只读 list。\n` +
        `headless 场景经文件直编 enabled.yaml 顶层 doors 段（值域 v1：${DOORS_SEGMENT_V1_DOMAIN.join('、')}），boot diff 记账覆盖（origin 'boot-diff'）。`,
    );
    return 1;
  }
  const result = runDoorsCommand(sub, { dataDir: options.dataDir ?? resolveDataDir(), fs: createPluginStoreFs() });
  if (result.ok) out(result.text);
  else err(result.text);
  return result.ok ? 0 : 1;
}
