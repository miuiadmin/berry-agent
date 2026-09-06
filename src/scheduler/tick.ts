/**
 * /tick 命令处理器（04 §12 六动词：add|list|rm|run|enable|disable）。
 *
 * 本件是纯程序面：引号感知 argv（03 §2.2 CommandArgs.argv 同律切分产物——
 * 切分归通道核，本件收词数组）→ 守卫/执行 → **人读文本**返回；通道呈现与
 * /tick 注册（channels CommandRegistry）归 host 装配批接线——scheduler
 * 模块不依赖 channels（02 §4.1 边表纪律）。
 *
 * 错误面：用法错与 BaseError（SCHEDULER_* 族）一律折文本返回（命令道不抛
 * ——用户面呈现）；/tick run = manual 道（引擎不走闸不受帽）。
 */
import { BaseError } from '../contracts/index.js';
import type { RunOutcome, TriggerKind } from './types.js';
import { formatSchedule } from './schedule.js';
import type { SchedulerEngine } from './engine.js';
import type { SchedulerService } from './service.js';

/** 处理器依赖（装配批注入） */
export interface TickCommandDeps {
  service: SchedulerService;
  engine: SchedulerEngine;
  /** clock 道（--tick 子进程回流编舞）/ manual 道（用户 /tick run）选源——缺省 manual */
  defaultTrigger?: TriggerKind;
}

/** 用法文案（用法错返回面——自包含） */
export const TICK_USAGE = `用法：
  /tick add <名> <schedule 串> <prompt 全文> [--cwd <绝对径>] [--enable]
  /tick list
  /tick rm <名>
  /tick run <名>
  /tick enable <名>
  /tick disable <名>
schedule 串形：every:<n>[s|m|h] / once@+<n>[s|m|h] / once@<ISO> / daily@HH:MM / weekly@<days>@HH:MM
（add 缺省建行停用——「存在 ≠ 启用」，enable 显式开跑）`;

/** /tick 处理入口（argv = 引号感知词切分产物；错误折文本不抛） */
export async function runTickCommand(argv: readonly string[], deps: TickCommandDeps): Promise<string> {
  try {
    return await dispatchTick(argv, deps);
  } catch (err) {
    if (err instanceof BaseError) return `✗ ${err.code}：${err.message}`;
    return `✗ 意外错误：${err instanceof Error ? err.message : String(err)}`;
  }
}

/** 分派体（守卫与动词编舞——throw 面由 runTickCommand 统一折文本） */
async function dispatchTick(argv: readonly string[], deps: TickCommandDeps): Promise<string> {
  const verb = argv[0] ?? '';
  switch (verb) {
    case 'add':
      return tickAdd(argv.slice(1), deps);
    case 'list':
      return tickList(deps);
    case 'rm': {
      const name = requireName(argv.slice(1), 'rm');
      deps.service.removeJob(name);
      return `✓ 已删除任务 ${name}`;
    }
    case 'run': {
      const name = requireName(argv.slice(1), 'run');
      const outcome = await deps.engine.fireNow(name, deps.defaultTrigger === 'cron' ? 'cron' : 'manual');
      return `□ 任务 ${name} 收场：${describeOutcome(outcome)}`;
    }
    case 'enable':
    case 'disable': {
      const name = requireName(argv.slice(1), verb);
      deps.service.setJobEnabled(name, verb === 'enable');
      return `✓ 任务 ${name} 已${verb === 'enable' ? '启用' : '停用（行留史）'}`;
    }
    case '':
    case 'help':
      return TICK_USAGE;
    default:
      return `✗ 未知动词「${verb}」（六动词之一）\n${TICK_USAGE}`;
  }
}

/** add 动词：位参 name/schedule/prompt + 可选 --cwd/--enable（选项须位参后） */
function tickAdd(rest: readonly string[], deps: TickCommandDeps): string {
  const positional: string[] = [];
  let cwd: string | undefined;
  let enable = false;
  for (let i = 0; i < rest.length; i++) {
    const tok = rest[i] ?? '';
    if (tok === '--cwd') {
      cwd = rest[++i];
      if (!cwd) throw new BaseError('SCHEDULER_JOB_INVALID', '--cwd 须带绝对路径值');
    } else if (tok === '--enable') {
      enable = true;
    } else if (tok.startsWith('--')) {
      throw new BaseError('SCHEDULER_JOB_INVALID', `未知选项「${tok}」（见 /tick add 用法）`);
    } else {
      positional.push(tok);
    }
  }
  const name = positional[0];
  const schedule = positional[1];
  const promptWords = positional.slice(2);
  if (!name || !schedule || promptWords.length === 0) {
    throw new BaseError(
      'SCHEDULER_JOB_INVALID',
      'add 须带三段位参：<名> <schedule 串> <prompt 全文>（prompt 含空格请整体引号）',
    );
  }
  const row = deps.service.addJob({
    name,
    schedule,
    prompt: promptWords.join(' '),
    cwd: cwd ?? null,
    enabled: enable,
  });
  const next = row.nextFireAt ? `下次到点 ${row.nextFireAt}` : '停用态（enable 后排刻）';
  return `✓ 已建任务 ${row.name}（${formatSchedule(row.schedule)}）——${next}`;
}

/** list 动词：全行人读表（名序；结局短描一列） */
function tickList(deps: TickCommandDeps): string {
  const rows = deps.service.listJobs();
  if (rows.length === 0) return '（无任务——/tick add 建第一个）';
  const lines: string[] = [];
  for (const row of rows) {
    const state = row.enabled ? '启用' : '停用';
    const next = row.nextFireAt ?? '—';
    const last = row.lastOutcome ? describeOutcome(row.lastOutcome) : '从未触发';
    const tags = [row.builtin ? '内置' : null].filter(Boolean).join('');
    lines.push(
      `${row.enabled ? '●' : '○'} ${row.name}${tags ? `（${tags}）` : ''} [${state}] ${formatSchedule(row.schedule)}｜下次 ${next}｜上局 ${last}`,
    );
  }
  return lines.join('\n');
}

/** 名位参提取（动词级守卫——缺席抛用法错） */
function requireName(rest: readonly string[], verb: string): string {
  const name = rest[0];
  if (!name || name.startsWith('--')) {
    throw new BaseError('SCHEDULER_JOB_INVALID', `/${verb === 'rm' ? 'tick rm' : 'tick ' + verb} 须带任务名位参`);
  }
  return name;
}

/** 结局短描（list 与 run 收场共用渲染） */
export function describeOutcome(outcome: RunOutcome): string {
  const head = `${outcome.trigger} 道 ${outcome.reason}`;
  const detail =
    outcome.gate !== undefined
      ? `（闸 ${outcome.gate}${outcome.error ? '：' + outcome.error : ''}）`
      : outcome.exitCode !== undefined
        ? `（退出码 ${outcome.exitCode}）`
        : outcome.error
          ? `（${outcome.error}）`
          : '';
  const preview = outcome.finalTextPreview ? `｜末文「${outcome.finalTextPreview}」` : '';
  return `${head}${detail}${preview}`;
}
