/**
 * host/plugins-command — TUI `/plugins` 命令面纯逻辑件（03 §5.8 三面同源之
 * TUI 面；task #88 笔二）。
 *
 * argv → `{ok, text}` 结算形（c-5 credentials/commands 同款底座形态）：动词语义
 * 与回执文本在此单源，TUI 装配面只消费 text 经 notify 归因 'plugins' 投递。
 * 与 CLI 面（plugins-cmd.ts runRowVerb）的分立点有三：
 *  1. **成功尾自动链 /reload**（03 §5.2——mount/unmount/toggle 经 TUI 命令面
 *     自动链；CLI 短命进程不装配装载器故不链，改行下次启动生效）；
 *  2. **审计 sink = 进程内 audit face**（assembly 单写者实例——与 CLI 惰性
 *     开库形分立；落账失败 warn 不阻塞主流程，行编辑已生效不回滚）；
 *  3. **回执文案指向自动链**（CLI 文案指「下次启动生效」——两面对同一行编辑
 *     动词的生效时点陈述各自诚实）。
 *
 * 子动词分账：
 *  - `list`：装载态清单三分区（启用/失败/禁用）——读内存 boot 报告投影（换血
 *    取值器闭包——/reload 换代后即见新代），零磁盘零开库。
 *  - `mount <id>` / `unmount <id>` / `toggle <id>`：enabled.yaml 行编辑
 *    （plugin-store 行编辑面同源）。mount 前置两查与 CLI 同律：id 词法 +
 *    装机在场（core: id 豁免查账——内置态天然在场）。
 *
 * 纯 memory 诊断形（dataDir null）无数据目录——写动词诚实拒（行编辑无落点），
 * list 仍可用（读内存投影）。
 */
import type { LoadReport } from './loader.js';
import { checkPluginId } from './manifest.js';
import { mountRow, readLedger, toggleRow, unmountRow } from './plugin-store.js';
import type { LifecycleAuditSink, PluginStoreFs } from './plugin-store.js';

/** 用法说明（命令描述位 + 未知动词回执共用单源） */
export const PLUGINS_CMD_USAGE = `/plugins list | mount <id> | unmount <id> | toggle <id>
  list                装载态清单三分区（启用/失败/禁用——内存读面零磁盘）
  mount <id>          挂载已装机插件（成功尾自动链 /reload）
  unmount <id>        卸下（装机保留——成功尾自动链 /reload）
  toggle <id>         禁用态翻转（成功尾自动链 /reload）
（install/uninstall/update 走 CLI：berry-agent plugins <sub>——03 §5.8 三面同源）`;

/** 结算形（ok 位留 CLI 对等面/测试分档；TUI 装配面只消费 text） */
export interface PluginsCommandOutcome {
  readonly ok: boolean;
  readonly text: string;
}

/** 命令面 deps（装配面注入——纯逻辑件零 fs/db 直连） */
export interface PluginsCommandDeps {
  /** 数据目录（null = 纯 memory 诊断形——写动词拒、list 放行） */
  readonly dataDir: string | null;
  /** 行编辑文件面（plugin-store 同源——与 CLI 同一 fs 词形） */
  readonly fs: PluginStoreFs;
  /** 生命周期归因账 sink（进程内 audit face 包装位——落账失败由包装方 warn） */
  readonly auditSink: LifecycleAuditSink;
  /** 自动链 /reload（成功尾恰一次——03 §5.2 TUI 命令面链路） */
  readonly requestReload: () => void;
  /** 装载报告取值器（换代取值器——/reload 后即新代投影） */
  readonly report: () => LoadReport | undefined;
}

/** list 三分区渲染（CLI list 同构输出——两面同源人读形） */
function renderList(report: LoadReport | undefined): string {
  if (report === undefined) {
    return '装载面未装配（noPlugins 诊断形）——无装载态可列。';
  }
  const lines: string[] = [];
  lines.push(`启用（${report.activated.length}）：`);
  for (const a of report.activated)
    lines.push(`  ${a.id}${a.skillDirs.length > 0 ? `  技能目录：${a.skillDirs.join('、')}` : ''}`);
  lines.push(`失败（${report.failed.length}）：`);
  for (const f of report.failed) lines.push(`  ${f.id}  [${f.code}] ${f.message}`);
  lines.push(`禁用（${report.skipped.length}）：`);
  for (const s of report.skipped) lines.push(`  ${s.id}  ${s.reason}`);
  return lines.join('\n');
}

/** mount 前置两查（CLI runRowVerb 同律单源复述——id 词法 + 装机在场） */
function mountPreflight(id: string, deps: PluginsCommandDeps): string | undefined {
  if (!checkPluginId(id, { official: true })) {
    return `插件 id 词法违例（${id}——小写字母数字连字符，官方件 core: 前缀同律）`;
  }
  if (!id.startsWith('core:')) {
    const ledgerRead = readLedger(deps.dataDir!, deps.fs);
    if (!ledgerRead.ok) {
      return `装机账本损坏：${ledgerRead.reason}——拒写防覆盖（03 §5.4）`;
    }
    if (!ledgerRead.entries.some((e) => e.id === id)) {
      return `插件 ${id} 未装机——mount 先走 install（未装机挂行会在下次启动读侧降级，03 §5.3）`;
    }
  }
  return undefined; // 两查全过
}

/**
 * `/plugins` 命令面主入口（argv → 结算形）。行编辑失败零副作用（无变更不造账
 * 不链 reload）；成功尾序 = audit 落账 → 自动链 /reload → 回执。
 */
export function runPluginsCommand(argv: readonly string[], deps: PluginsCommandDeps): PluginsCommandOutcome {
  const verb = argv[0];
  // list：读内存投影——dataDir null 与 noPlugins 形均诚实呈现（零写面）
  if (verb === 'list') {
    return { ok: true, text: renderList(deps.report()) };
  }
  if (verb === 'mount' || verb === 'unmount' || verb === 'toggle') {
    if (deps.dataDir === null) {
      return { ok: false, text: '纯 memory 诊断形无数据目录——写动词不可用（行编辑无落点）' };
    }
    const id = argv[1];
    if (id === undefined || id === '') {
      return { ok: false, text: `用法错——缺 <id>。\n${PLUGINS_CMD_USAGE}` };
    }
    if (verb === 'mount') {
      const rejected = mountPreflight(id, deps);
      if (rejected !== undefined) return { ok: false, text: rejected };
    }
    const result =
      verb === 'mount'
        ? mountRow(deps.dataDir, id, undefined, deps.fs, deps.auditSink)
        : verb === 'unmount'
          ? unmountRow(deps.dataDir, id, deps.fs, deps.auditSink)
          : toggleRow(deps.dataDir, id, deps.fs, deps.auditSink);
    if (!result.ok) {
      return { ok: false, text: result.message }; // 行编辑失败——零副作用零链
    }
    // 成功尾：自动链 /reload（fire-and-forget——busy 期 reloader 自排队）
    deps.requestReload();
    const tail = '已自动链 /reload（会话运行中自动排队，run 收场后执行）';
    return {
      ok: true,
      text:
        verb === 'mount'
          ? `已挂载：${id}——${tail}`
          : verb === 'unmount'
            ? `已卸下：${id}（装机保留）——${tail}`
            : `已切换：${id} 禁用态翻转——${tail}`,
    };
  }
  return { ok: false, text: `未知动词或用法错。\n${PLUGINS_CMD_USAGE}` };
}
