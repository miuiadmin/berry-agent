/**
 * host/static-completions — 静态补全源单源件（2026-09-23 host 编舞批；承
 * tui-entry.ts 尾部纯补全源块迁出——与 live-completions.ts 对称：活体值源
 * 之外的一切编译期可知补全面归本件）。
 *
 * **单源律**：命令补全条目（commandItems）、退出词表（EXIT_WORDS /
 * EXIT_DESCRIPTIONS）、静态参数源（commandArgumentItems）与模型短名
 * （modelShortName——footer 常驻段呈现）的唯一宿主是本件；tui-entry 装配位
 * 与 webui 侧任何新消费面同源取用（session-tier-copy.ts 2026-09-18 外迁
 * 先例同律：无消费位即不导出承诺——VERB_META 只服务 commandArgumentItems
 * 自身，不导出、不预设 /help 复用）。词表单源在各命令件（SUBVERBS 族）/
 * safety（APPROVAL_PRESETS）/ contracts（USER_GRANTABLE_CAPABILITIES）——
 * 本件只持拼装与说明位，不复制词表。
 */
import { fuzzyFilter } from '../channels/index.js';
import type { AutocompleteItem } from '../channels/index.js';
import { USER_GRANTABLE_CAPABILITIES } from '../contracts/api.js';
import { APPROVAL_PRESETS } from '../safety/index.js';
import { REWIND_SUBVERBS } from '../checkpoint/index.js';
import { APPROVAL_SUBVERBS } from './approval-cmd.js';
import { DOORS_SUBVERBS } from './doors-cmd.js';
import { PLUGINS_SUBVERBS } from './plugins-command.js';

/** 命令表 → 补全条目（fuzzy 子序列过滤——query 已去斜杠，前缀命中置顶；R6 批 10j） */
function commandItems(
  specs: readonly { name: string; description?: string }[],
  query: string,
): readonly AutocompleteItem[] {
  return fuzzyFilter(specs, (spec) => spec.name, query).map((spec) => ({
    label: `/${spec.name}`,
    ...(spec.description !== undefined ? { detail: spec.description } : {}),
    replacement: `/${spec.name}`,
  }));
}

/** TUI 本地退出词表（07 §4.1 /exit 批——单正名；/quit 别名已随 2026-09-21 三反馈批A 退役） */
const EXIT_WORDS = ['exit'] as const;

/** 退出词说明（单源——补全条目与 /help 命令册两消费面同文） */
const EXIT_DESCRIPTIONS: Readonly<Record<(typeof EXIT_WORDS)[number], string>> = {
  exit: '退出 TUI（与 Ctrl+D 同路优雅退出）',
};

/**
 * 退出词 → 补全条目（与通道命令表分源——前端生命周期词不进通道核命令表，
 * 装配位并流；query 已去斜杠，同 commandItems 契约）。
 */
export function exitCommandItems(query: string): readonly AutocompleteItem[] {
  return fuzzyFilter(EXIT_WORDS, (name) => name, query).map((name) => ({
    label: `/${name}`,
    detail: EXIT_DESCRIPTIONS[name],
    replacement: `/${name}`,
  }));
}

/** 模型短名（footer 常驻段呈现——provider/model 形取 model 段，裸名原样） */
function modelShortName(model: string): string {
  const slash = model.lastIndexOf('/');
  return slash === -1 ? model : model.slice(slash + 1);
}

/* ---------------- 命令参数补全源（R6 批 10j 装配接线） ---------------- */

/** 带参补全的四命令子动词名集（单源 = 各命令件 SUBVERBS 导出） */
const SUBVERBS_BY_COMMAND: Readonly<Record<string, readonly string[]>> = {
  approval: APPROVAL_SUBVERBS,
  plugins: PLUGINS_SUBVERBS,
  doors: DOORS_SUBVERBS,
  rewind: REWIND_SUBVERBS,
};

/**
 * 子动词元数据（键 = 「命令 动词」；值 = [说明, 是否带尾参]——带参者补全
 * replacement 尾随空格，应用后直接进下一 token 位）。名集单源在各命令件，
 * 说明位与名集同文件可目检同步。**件内私有**——无 /help 等外部消费位即
 * 不导出（导出面 = 消费承诺，无消费不承诺）。
 */
const VERB_META: Readonly<Record<string, readonly [string, boolean]>> = {
  'approval status': ['当前态：sandbox 档 + 审批 policy + 预设一览', false],
  'approval entries': ['策略表全列（活体现读）', false],
  'approval explain': ['真裁决干跑（须带 <tool>）', true],
  'approval preset': ['预设写盘（conservative|balanced|open）', true],
  'plugins list': ['装载态清单三分区', false],
  'plugins mount': ['挂载已装机插件 <id>', true],
  'plugins unmount': ['卸下（装机保留）<id>', true],
  'plugins toggle': ['禁用态翻转 <id>', true],
  'plugins config': ['配置表单 <id>', true],
  'doors list': ['高危面全清单 + 当前开态', false],
  'doors open': ['开门 <capability>', true],
  'doors close': ['关门 <capability>', true],
  'rewind list': ['列当前工作区回退点', false],
  'rewind preview': ['预演（零改动）<id>', true],
  'rewind restore': ['回退并 fork 新会话 <id>', true],
  'rewind help': ['用法说明', false],
};

/**
 * 命令参数源（R6 批 10j）——**静态面**：四命令子动词首参 + 深位枚举
 * （approval preset 预设名 / doors open·close 能力名——枚举单源 = safety
 * 预设表与 contracts 面目录）。插件 id、回退点 id 活体位归
 * {@link liveCommandArgumentItems}（挂账解挂批 2026-09-15 落地——装配位
 * 两源并流：活体先行、null 回退本静态面）。query = 当前 token 原文、
 * priorArgs = 已定参数序。
 */
export function commandArgumentItems(
  command: string,
  query: string,
  priorArgs: readonly string[],
): readonly AutocompleteItem[] {
  // 深位枚举：approval preset <名>——预设三档（名与描述 = safety 单源）
  if (command === 'approval' && priorArgs.length === 1 && priorArgs[0] === 'preset') {
    return fuzzyFilter(APPROVAL_PRESETS, (preset) => preset.name, query).map((preset) => ({
      label: preset.name,
      detail: preset.description,
      replacement: `${preset.name} `,
    }));
  }
  // 深位枚举：doors open|close <capability>——可授能力名（contracts 面目录派生）
  if (command === 'doors' && priorArgs.length === 1 && (priorArgs[0] === 'open' || priorArgs[0] === 'close')) {
    return fuzzyFilter(USER_GRANTABLE_CAPABILITIES, (name) => name, query).map((name) => ({
      label: name,
      replacement: `${name} `,
    }));
  }
  // 首参子动词（非首参位不补——活体值不在静态面）
  const verbs = SUBVERBS_BY_COMMAND[command];
  if (verbs === undefined || priorArgs.length > 0) return [];
  return fuzzyFilter(verbs, (verb) => verb, query).map((verb) => {
    // 元数据缺席兜底：零说明 + 尾空格（带参安全缺省）
    const [detail, takesArg] = VERB_META[`${command} ${verb}`] ?? ['', true];
    return {
      label: verb,
      ...(detail !== '' ? { detail } : {}),
      replacement: takesArg ? `${verb} ` : verb,
    };
  });
}

/* ---------------- 装配位再导出面（tui-entry 消费位单点收口） ---------------- */

// commandItems / modelShortName / EXIT_WORDS / EXIT_DESCRIPTIONS 是 tui-entry
// 装配位的消费符号——本件四符号统一经装配位出口转递（tui-entry import 单点；
// 测试面消费 exitCommandItems / commandArgumentItems 两纯函数直取本件）。
export { commandItems, modelShortName, EXIT_WORDS, EXIT_DESCRIPTIONS };
