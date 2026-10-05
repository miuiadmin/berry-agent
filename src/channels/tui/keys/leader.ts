/**
 * Ctrl+X leader 前缀键系——纯态机（2026-10-05 ZCode TUI 对标批 B4——07
 * §4.1 B4 定形注）。
 *
 * 两段前缀键机制：ctrl+x 入待续态（armed——2 秒窗），窗内裸字母 b/m/h
 * 分发 /jobs（后台任务）/ /model（模型选择）/ /help（帮助）。机制语义照搬
 * ZCode tui app-sidebar-shortcut.ts 的 leader 态机（惰性窗判无自愈定时器、
 * 大小写不敏感 arm、非匹配任意键解除 + 透传、重按续窗经解除 + 重装两跳
 * 达成）；其「提示无定时退场」滞留 wart 不搬（待续提示随窗定时退场归
 * backend 装排——armEscapeWindow 形）。上游此面零测试——本仓测试面自建
 * （leader.test.ts 纯锁 + backend 组合锁双面）。
 *
 * 键串文法不扩：本族不走键位册解析（arm 键 ctrl+x 硬编码不可配置——「打断
 * 永可达」安全位族外的独立前缀空间）；册面复合投影串（'ctrl+x b' 形）仅供
 * /help 可发现性（承「收录条目仅供面板投影可发现性」——绑定永不命中，
 * 真源恒在此态机 + backend 层③.4 路由）。
 *
 * 分诊意图两调用位（backend routeEvent）：
 *   - 头部（层⓪）：armed 态对每输入事件先判——followup / cancel / disarm
 *     三值在此消费或透传；arm 值在此**不消费**（透传——归层③.4 结构位）。
 *   - 层③.4（overlay/弹层之后、层③.5 之前）：只认 arm 值——层序结构性保
 *     「模态期间不 arm」（模态先消费的键到不了此），门判（五闸）双保险。
 */

import type { InputEvent } from '../../engine/index.js';
import { splitGraphemes } from '../../engine/index.js';

/** leader 分支集（b/m/h → 后台任务清单 / 模型选择 / 帮助——分发复用命令 dispatch 单源） */
export type LeaderBranch = 'jobs' | 'model' | 'help';

/** 分支字母映射（小写单源——大小写不敏感比对经 toLowerCase 收敛） */
const BRANCH_BY_LETTER: Readonly<Record<string, LeaderBranch>> = {
  b: 'jobs',
  m: 'model',
  h: 'help',
};

/**
 * 待续窗时长（ms）。与 ctrl+d 防误退双击窗同批同定值 2 秒——backend 装配位
 * 共用本单源（QUIT_CONFIRM_WINDOW_MS 引此）。
 */
export const LEADER_WINDOW_MS = 2000;

/** 待续态（armedUntilMs = 装排时刻 + LEADER_WINDOW_MS；null = 未待续）。无自愈定时器——窗判恒惰性（nowMs <= armedUntilMs），陈锚不碍事（下次 arm 覆写） */
export interface LeaderState {
  readonly armedUntilMs: number | null;
}

/**
 * 事件分诊所需门控聚合（调用位现算——本件零 backend 触感）：
 * - armGatesOpen：arm 五闸（= `?` 教学键同门——空稿 + 闲态 + overlay 不在
 *   场 + 弹层不在场 + 无 input-ask 应答窗；不满足透传编辑器终局丢弃）；
 * - branchGatesOpen：分支四闸（arm 门减闲态——忙期开 /jobs 正是高频用法：
 *   arm 后忙态起，窗内分支照开）；
 * - busy：忙态 escape 例外判据（忙期 escape 让路层①打断——打断是生命线，
 *   待续态不与之争）。
 */
export interface LeaderGates {
  readonly armGatesOpen: boolean;
  readonly branchGatesOpen: boolean;
  readonly busy: boolean;
}

/**
 * 分诊意图（五值）。吞零键律：disarm 恒伴透传（本函数只判意图，无「静默吞
 * 非匹配键」形——消费/透传归调用位）。
 */
export type LeaderIntent =
  /** ctrl+x 入待续态（仅层③.4 调用位消费；头部调用位透传） */
  | { kind: 'arm' }
  /** 窗内分支字母命中（rest = 合并游程余字素——交调用位补入稿不丢字，jump 待靶态同律） */
  | { kind: 'followup'; branch: LeaderBranch; rest: string }
  /** escape 取消（闲态——消费） */
  | { kind: 'cancel' }
  /** 解除 + 透传（非匹配任意键 / 窗过期 / 分支门闭 / 忙态 escape 让路） */
  | { kind: 'disarm' }
  /** 零涉（未待续非 arm 键 / release·mouse·ime 预编辑透明事件） */
  | { kind: 'none' };

/** arm 键判：ctrl+x（裸 ctrl 修饰——alt/shift/meta 任一即不认；大小写不敏感） */
function isArmKey(ev: InputEvent): boolean {
  return (
    ev.kind === 'key' &&
    ev.phase !== 'release' &&
    ev.ctrl &&
    !ev.alt &&
    !ev.shift &&
    !ev.meta &&
    ev.key.toLowerCase() === 'x'
  );
}

/** 裸 escape 判（无修饰——带修饰 escape 不认取消，归解除透传） */
function isBareEscape(ev: InputEvent): boolean {
  return (
    ev.kind === 'key' && ev.phase !== 'release' && ev.key === 'escape' && !ev.ctrl && !ev.alt && !ev.shift && !ev.meta
  );
}

/**
 * 分支字母判（text 主路 / ime 提交 / key 防御位三路同语义——jump 待靶态形）：
 * 首字素（字素切分保组合字素完整）恰为裸字母 b/m/h 才命中；带 ctrl/alt/meta
 * 修饰不认（shift 允许——大写字母同分支）。命中返回分支 + 余字素（合并游程
 * 'bm' 形——首字素作分支、余字素交调用位补入稿）；首字素非分支字母（如
 * CJK）整 run 不命中（不劈游程——透传归编辑器原语义）。
 */
function branchOfEvent(ev: InputEvent): { branch: LeaderBranch; rest: string } | null {
  if (ev.kind === 'text' || (ev.kind === 'ime' && ev.committed)) {
    if (ev.text.length === 0) return null;
    const graphemes = splitGraphemes(ev.text);
    const head = graphemes[0]!;
    const branch = BRANCH_BY_LETTER[head.toLowerCase()];
    if (branch === undefined || head.length !== 1) return null; // 组合字素（肤质修饰等）非裸字母
    return { branch, rest: graphemes.slice(1).join('') };
  }
  if (
    ev.kind === 'key' &&
    ev.phase !== 'release' &&
    ev.key.length === 1 &&
    !ev.ctrl &&
    !ev.alt &&
    !ev.meta // shift 允许
  ) {
    const branch = BRANCH_BY_LETTER[ev.key.toLowerCase()];
    return branch === undefined ? null : { branch, rest: '' };
  }
  return null;
}

/**
 * leader 事件分诊（纯函数——状态不内持，调用位持锚回传）。
 *
 * 判序：透明事件（release 相 / mouse / ime 预编辑——非用户新意图，零状态
 * 变更）→ arm 键 → 惰性窗判 → 分支字母 → escape → 其余任意事件解除 +
 * 透传（吞零键——层①②③先消费的键也经此解除，待续态不滞留成陈态）。
 */
export function resolveLeaderIntent(
  state: LeaderState,
  ev: InputEvent,
  nowMs: number,
  gates: LeaderGates,
): LeaderIntent {
  // 透明事件：kitty 轨按键释放（press 的影子事件——非新意图）、mouse（主屏
  // 零鼠标——防御位）、ime 预编辑（组合中非提交——jump 待靶态同律不消费、
  // 待续态不随组合进度解除）
  if (ev.kind === 'mouse') return { kind: 'none' };
  if (ev.kind === 'key' && ev.phase === 'release') return { kind: 'none' };
  if (ev.kind === 'ime' && !ev.committed) return { kind: 'none' };

  // arm 键：未待续（或窗过期）+ 五闸开 → arm；待续中 → 解除 + 透传（层③.4
  // 随即重装新窗——重按续窗语义经两跳等价达成）；闸闭 → 零涉透传（编辑器
  // 终局丢弃——零打扰）
  if (isArmKey(ev)) {
    if (state.armedUntilMs !== null && nowMs <= state.armedUntilMs) return { kind: 'disarm' };
    return gates.armGatesOpen ? { kind: 'arm' } : { kind: 'none' };
  }

  // 惰性窗判：未待续零涉；窗过期（首事件撞上陈锚）解除 + 透传（锚归调用位清）
  if (state.armedUntilMs === null) return { kind: 'none' };
  if (nowMs > state.armedUntilMs) return { kind: 'disarm' };

  // 分支字母：四闸开 → 命中消费（字母不入稿——rest 余字素交调用位补入）；
  // 门闭（如 input-ask 应答窗开）→ 解除透传（字母作普通字符入稿）
  const branch = branchOfEvent(ev);
  if (branch !== null) {
    return gates.branchGatesOpen ? { kind: 'followup', branch: branch.branch, rest: branch.rest } : { kind: 'disarm' };
  }

  // escape：忙态让路层①打断（解除 + 透传——打断先消费）；闲态取消（消费）
  if (isBareEscape(ev)) return gates.busy ? { kind: 'disarm' } : { kind: 'cancel' };

  // 其余任意事件（含层①②③将先消费的键——ctrl+c/ctrl+d/浮层键）：解除 +
  // 透传（吞零键——待续态对既有路由零侵入，只借道头部解除不滞留）
  return { kind: 'disarm' };
}
