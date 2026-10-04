/**
 * host/live-completions — 活体值补全源（挂账解挂批 2026-09-15；07 §4.1 R6）。
 *
 * 静态参数源（commandArgumentItems）只覆盖编译期可知的枚举位（子动词首参
 * / 预设名 / 能力名）；插件 id、回退点 id 等**活体值**（装载面现态、库中
 * manifest 清单）不在静态面。本件提供四活体位的参数补全条目铸造：
 * - `/plugins mount|unmount|toggle|config <id>` 尾参位——已受理集 =
 *   activated ∪ skipped（failed 不入可操作面——四动词的操作对象是已受理
 *   插件）；每查询现取（换代表即新投影——不缓存）。
 * - `/rewind preview|restore <id>` 尾参位——回退点清单**异步形**（R6 union
 *   协议 Promise 腿：库读天然异步）；label 呈现 8 位截形短 id（与 /rewind
 *   list 行渲染同判据——列表对齐），replacement 携全 id 尾空格（loadManifest
 *   吃全 id）。
 * - `/export|/resume <id>` 首参位（2026-10-01 自 tui-entry 装配闭包迁入——
 *   两命令同源合流）：会话清单 = manager 全量行（/sessions 清单同一读面）；
 *   label 8 位截形 + replacement 全 id 尾空格 + detail 展示题合并单源。
 * - `/goal show|wake|approve|abandon <goalId>` 尾参位（wf_3c8b00b8 A-6 +
 *   03 §10.5 abandon 开面批）：goal 清单 = service.list() 全量行（/goal list
 *   同一读面）；label 全 id 原样（goal id 自短不截形）+ detail objective 40
 *   截形（list 行同判据）。
 *
 * 返回协议（与补全源 union 契约对齐）：命中活体位 → 同步数组（plugins 位）
 * 或 Promise（rewind 位）；**位外 / 依赖缺席 → null**（诚实缺席——装配位
 * null 归静态面回退，不虚报空集）。依赖注入为取值器闭包（每查询现取——
 * 与 FileMentionSource per-query 新铸同族）。
 */
import { fuzzyFilter, type AutocompleteItem } from '../channels/index.js';
import { sessionDisplayTitleOf } from '../persist/index.js';

/**
 * 活体值补全依赖（装配位注入——两取值器均可缺席，缺席 = 对应活体位 null
 * 诚实缺席归静态面）。
 */
export interface LiveCompletionDeps {
  /**
   * 插件装载面报告取值器（每查询现取）：返回 activated ∪ skipped 即可操作
   * id 集真源（LoadReport 子集形——failed 不在可操作面）。返回 undefined =
   * 报告不可达（boot 前形）——本位诚实缺席。
   */
  readonly pluginReport?: () =>
    | {
        readonly activated: readonly { readonly id: string }[];
        readonly skipped: readonly { readonly id: string }[];
      }
    | undefined;
  /**
   * 回退点清单取值器（异步形——R6 union 协议 Promise 腿；每查询现取）：
   * 返回 manifest 清单（CheckpointManifest 子集形——id 位即补全判据面）。
   */
  readonly rewindManifests?: () => Promise<readonly { readonly id: string }[]>;
  /** 会话清单取值器（每查询现取——manager 全量行；缺席 = 会话 id 位诚实缺席）。
   *  结构子集形：id 补全判据面 + 展示题读路两键（sessionDisplayTitleOf 结构
   *  可选形天然兼容）。 */
  readonly sessionRows?: () => readonly {
    readonly id: string;
    readonly title?: string | undefined;
    readonly firstQuestionSummary?: string | undefined;
  }[];
  /** goal 清单取值器（每查询现取——service.list() 全量行；缺席 = goal 件不在
   *  场诚实缺席归静态面）。结构子集形：id 补全判据面 + objective detail 面。 */
  readonly goalRows?: () => readonly { readonly id: string; readonly objective: string }[];
}

/** /plugins 尾参位动词集（四动词同一位——list/help 等无尾参动词不入） */
const PLUGINS_ID_VERBS: ReadonlySet<string> = new Set(['mount', 'unmount', 'toggle', 'config']);

/** /rewind 尾参位动词集（preview|restore 同位同源——help/list 不入） */
const REWIND_ID_VERBS: ReadonlySet<string> = new Set(['preview', 'restore']);

/** /goal 尾参位动词集（show|wake|approve|abandon 同位同源——create 尾参是
 * schedule/objective 非 goalId、list 无尾参，均不入；abandon 入列 = 03 §10.5
 * 第十一轮收官呈拍批定形③补全面四处之一） */
const GOAL_ID_VERBS: ReadonlySet<string> = new Set(['show', 'wake', 'approve', 'abandon']);

/**
 * 活体值参数补全条目铸造（纯函数——测试直锁消费面；装配位 null 归静态面）。
 * @param command 已终结命令名（去斜杠——与 commandArguments 源契约同形）
 * @param query 当前参数 token 原文
 * @param priorArgs 命令名与光标 token 之间的已定参数序（尾参位判据 =
 *        恰 1 个动词；首参动词位/深位归静态面）
 * @param deps 活体依赖（缺席位诚实缺席）
 */
export function liveCommandArgumentItems(
  command: string,
  query: string,
  priorArgs: readonly string[],
  deps: LiveCompletionDeps,
): readonly AutocompleteItem[] | Promise<readonly AutocompleteItem[]> | null {
  // 位判一：/plugins 四动词尾参位（同步腿——报告取值器同步返回）
  if (command === 'plugins' && priorArgs.length === 1 && PLUGINS_ID_VERBS.has(priorArgs[0]!)) {
    const report = deps.pluginReport?.();
    if (report === undefined) return null; // 报告源缺席 = 诚实缺席（归静态面）
    // 已受理集 = activated ∪ skipped（failed 不入——非四动词可操作对象）
    const ids = [...report.activated, ...report.skipped].map((entry) => entry.id);
    return fuzzyFilter(ids, (id) => id, query).map((id) => ({
      label: id,
      replacement: `${id} `, // 尾空格——应用后直接进下一 token 位
    }));
  }
  // 位判二：/rewind preview|restore 尾参位（异步腿——Promise 返回即 union 协议）
  if (command === 'rewind' && priorArgs.length === 1 && REWIND_ID_VERBS.has(priorArgs[0]!)) {
    const fetchManifests = deps.rewindManifests;
    if (fetchManifests === undefined) return null; // 清单源缺席 = 诚实缺席
    return fetchManifests().then((manifests) =>
      // 过滤与短形铸造在异步腿内完成（query 是发起时快照——防抖序由调度器保证）
      fuzzyFilter(
        manifests.map((manifest) => manifest.id),
        (id) => id,
        query,
      ).map((id) => ({
        label: shortCheckpointId(id),
        replacement: `${id} `, // 全 id 尾空格（loadManifest 吃全 id——label 才是截形）
      })),
    );
  }
  // 位判三：/export 与 /resume 首参会话 id 位（2026-10-01 自 tui-entry 装配闭包
  // 迁入——两命令同源合流同一位；与 plugins/rewind 两活体位同族）。rows =
  // manager 全量行（/sessions 清单注入同一读面——库行真源；零事件新会话无行
  // 不补——与 /sessions 清单同边界）。label 短形（8 位截形与回退点 id 同判据）
  // + replacement 全 id 尾空格；detail = 展示题读路合并单源（05 §9 v13 分家③
  // ——显式题优先/首问快照兜底；合并值空串/缺席不造行）
  if ((command === 'export' || command === 'resume') && priorArgs.length === 0) {
    const fetchRows = deps.sessionRows;
    if (fetchRows === undefined) return null; // 清单源缺席 = 诚实缺席（归静态面）
    return fuzzyFilter(fetchRows(), (row) => row.id, query).map((row) => {
      const displayTitle = sessionDisplayTitleOf(row);
      return {
        label: shortCheckpointId(row.id),
        ...(displayTitle !== undefined && displayTitle !== '' ? { detail: displayTitle } : {}),
        replacement: `${row.id} `,
      };
    });
  }
  // 位判四：/goal show|wake|approve|abandon 尾参 goal id 位（同步腿——
  // service.list() 同步返回；A-6 组γ第四活体位 + abandon 开面批并入）。label
  // 全 id 原样（goal id 自短——/goal list 行渲染同判据不截形）；detail =
  // objective 前 40 截形（对齐 list 行呈现）；replacement 全 id 尾空格
  // （get/wake/approve/abandon 消费面吃全 id）
  if (command === 'goal' && priorArgs.length === 1 && GOAL_ID_VERBS.has(priorArgs[0]!)) {
    const fetchRows = deps.goalRows;
    if (fetchRows === undefined) return null; // 清单源缺席 = 诚实缺席（goal 件不在场归静态面）
    return fuzzyFilter(fetchRows(), (row) => row.id, query).map((row) => ({
      label: row.id,
      detail: row.objective.slice(0, 40),
      replacement: `${row.id} `,
    }));
  }
  return null; // 位外 = null 回退静态面（子动词首参 / list 尾参 / 深位 / 非两命令）
}

/** 回退点 id 短形呈现（8 位截形 + …——与 /rewind list 行渲染同判据单源同形） */
function shortCheckpointId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}
