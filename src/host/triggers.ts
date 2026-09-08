/**
 * host/triggers — 触发器注册面（03 §2.2 行 108 ctx.triggers.register 第十一动词
 * + §2.7 触发器行冲突律 + §4.6 开门制；2026-09-07 触发器面 C 批 C-2 注册面笔
 * + C-3 starter 笔）。
 *
 * 一件三面：
 *  - **注册表本体**（单实例随装配根创建；插件经 ctx.triggers.register 间接消费
 *    ——窗口/频率护栏在 ctx 面执法，本件只管三闸与 starter 交接）：
 *    闸一 门检（`triggers.start-run` 高危面默认关——03 §4.6；core: 官方件直开
 *    豁免〔装配即用户意图，§4.6 勘补判据——官方件随构建进包非生态授予面〕；
 *    开门授予集经 `getOpens` **活体读取源**现取现判——与 fire 复检同源，
 *    /reload 撤位后旧 starter 复检即拒，开门可收回）；
 *    闸二 撞名（TRIGGER_NAME_EXISTS——词法身份面拒绝式，重影即审计归因歧义；
 *    先于格式闸，「名字被占用」比「格式违例」更指向根因，registerMessageRole
 *    同序）；
 *    闸三 名词法（TRIGGER_NAME_INVALID——域名两段式〔恰含一个 /、两段均小写
 *    字母数字连字符〕且域前缀 == 本插件 id，core: 件去前缀取 name 段比对
 *    ——防跨插件冒名，registerSection 同法）。
 *  - **starter 一次性交接**：注册成功即回调 `def.fire(starter)` 注入起会闭包
 *    （03 §2.2 行 108 定形注记——重装载经重注册重新注入，旧 starter 因 fire
 *    复检悬空失效不悬空越权）。
 *  - **starter 真身工厂**（createTriggerStarterFactory——装配根注入窄依赖面
 *    造 `(pluginId, name) => starter`）：fire 复检（活体开门收回）→ Job 受理
 *    **先于**起会（「fire 受理先过帽再起会话」——帽满 JOB_LIMIT_REACHED /
 *    显式 jobKind 未登记 JOB_KIND_UNKNOWN，不起会不留孤儿）→ 起无头会话
 *    （origin 'trigger' + source `plugin:<id>` 归因 + per-fresh-session 模型
 *    载体）→ 回执三终态映射 Job 终态（completed→completed / aborted→killed /
 *    failed→failed；injected/wake-refused = run 未起落 failed）。**starter
 *    永不 throw**——插件事件源回调内执行，throw 即进程级风险；拒与失败一律
 *    warn 可观测 + Job 终态收口（无人值守鲁棒性）。
 *
 * 挂账注记：capability/used 逐次审计随 U3 落码批接线（audit_events 载体缺席；
 * v1 归因面经事件流 source=`plugin:<id>` 已闭集可查——03 §2.2 行 108 定形注记）；
 * JobHandle.stop→interrupt 桥接与插件卸载 closeOwner(pluginId) 收口已在飞
 * Job 均随 Job 消费面批兑现（04 §10 定形：onStop 协作中止路由 + 卸载接线位
 * = plugin-unload closer——本文件两桥腿 = starter 注册 onStop 路由到起会
 * 驱动 abort；closeOwner 接线在 plugin-boot 装配件）。
 */
import { BaseError } from '../contracts/index.js';
// internal 桶机制符号深导（门检裁决核——03 §4.6；开门是宿主裁决面非插件 API）
import { adjudicateCapabilityDoor } from '../contracts/api.js';
import type { EventSource, JobKind } from '../contracts/index.js';
import type { OpenedSession, SessionManager, SubmitOptions, SubmitResult } from '../conversation/index.js';
import type { JobHandle, JobRegistry } from '../subagent/index.js';
import type { Disposer } from '../context/index.js';

/** 起会参数（starter 单参——03 §2.2 行 108 starter(spec) 签名定形） */
export interface TriggerStartSpec {
  /** 起会提示（无头会话首条 UserMessage 输入——source=`plugin:<id>` 归因） */
  readonly prompt: string;
  /** 会话标题（缺席机器派生——触发器名 + 起会时刻） */
  readonly title?: string;
  /** 模型覆盖（缺席回落宿主模型） */
  readonly model?: string;
  /** Job 托管 kind（缺席隐式 'trigger'——host 装配期自登 + 缺省并行帽 4） */
  readonly jobKind?: JobKind;
}

/** starter 闭包签名（注入 def.fire 的一次性交接物——真身随 C-3 装配批实装） */
export type TriggerStarter = (spec: TriggerStartSpec) => void;

/** 触发器 def 三件形（ctx.triggers.register 单参——03 §2.2 行 108） */
export interface TriggerDef {
  /** 触发器名（域名两段式 `域前缀/名`——域前缀须等于本插件 id，core: 件去前缀比对） */
  readonly name: string;
  /** 描述（开门呈现面——用户决定是否 opens 授予的判断依据） */
  readonly description: string;
  /** 事件源回调（注册成功即注入 starter 一次——插件自有事件源持有之） */
  readonly fire: (starter: TriggerStarter) => void;
}

/** 在册触发器条目（枚举面——测试/审计读侧） */
export interface TriggerEntry {
  /** 触发器名（域名两段式——注册键本体） */
  readonly name: string;
  /** 注册方插件 id（core: 含前缀原形） */
  readonly owner: string;
  /** 描述（开门呈现面原文） */
  readonly description: string;
}

/** 构造选项（装配根注入两闭包——本件零宿主依赖，纯逻辑可测） */
export interface TriggerRegistryOptions {
  /**
   * 开门授予集活体读取源（03 §4.6 + F10 定形——register 前置门检与 fire 复检
   * 共用同源：每次调用现读，/reload 撤位后旧 starter 复检即拒）。未装载插件
   * id = 空集（全默认关——fire 复检可收回语义的未装载档）。
   */
  readonly getOpens: (pluginId: string) => ReadonlySet<string>;
  /** starter 真身工厂（C-3 装配批注入——起无头会话 + Job 托管编舞） */
  readonly makeStarter: (pluginId: string, name: string) => TriggerStarter;
}

/** 触发器名词法（域名两段式——两段均小写字母起头的小写字母数字连字符串，messages CUSTOM_ROLE_RE 同法） */
const TRIGGER_NAME_RE = /^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/;

/** 域前缀归一（core: 件去前缀取 name 段比对——prompt-sections domainOf 同法） */
function domainOf(pluginId: string): string {
  return pluginId.startsWith('core:') ? (pluginId.slice('core:'.length) ?? pluginId) : pluginId;
}

/**
 * 触发器注册表（单实例随装配根创建；core: 域与生态域同册——跨插件撞名互斥，
 * 防官方件与生态插件同域重影）。零半注册残留：三闸全过才落册，fire 抛错回滚。
 */
export class TriggerRegistry {
  /** 触发器名 → 条目（枚举序 = 注册序——Map 插入序） */
  private readonly triggers = new Map<string, TriggerEntry>();

  constructor(private readonly options: TriggerRegistryOptions) {}

  /**
   * 注册触发器（拒绝式三闸：门检 → 撞名 → 格式）。
   * @returns 注销器（只摘本人条目——重注后旧注销器不误摘接任者）
   */
  register(pluginId: string, def: TriggerDef): Disposer {
    // 闸一：高危面门检（03 §4.6——triggers.start-run 默认关；授予集活体现判，
    // 与 fire 复检同源开门可收回）。core: 官方件直开豁免——装配即用户意图
    if (!pluginId.startsWith('core:')) {
      const verdict = adjudicateCapabilityDoor(this.options.getOpens(pluginId), 'triggers.start-run');
      if (!verdict.ok) {
        throw new BaseError('PLUGIN_CAPABILITY_DOOR_CLOSED', `${verdict.message}（插件 ${pluginId}）`);
      }
    }
    // 闸二：撞名（先于格式闸——在册名必已合法，「名字被占用」更指向根因）
    const existing = this.triggers.get(def.name);
    if (existing !== undefined) {
      throw new BaseError(
        'TRIGGER_NAME_EXISTS',
        `触发器 ${def.name} 已在册（注册方 ${existing.owner}）——词法身份面拒绝式，重影即审计归因歧义（03 §2.7）`,
      );
    }
    // 闸三：名词法（域名两段式 + 域前缀 == 本插件 id——core: 件去前缀比对）
    const slash = def.name.indexOf('/');
    if (!TRIGGER_NAME_RE.test(def.name) || slash <= 0 || def.name.slice(0, slash) !== domainOf(pluginId)) {
      throw new BaseError(
        'TRIGGER_NAME_INVALID',
        `触发器名 ${def.name} 非域名两段式或域前缀 ≠ 本插件 id（须 ${domainOf(pluginId)}/名——恰含一个 / 且两段均小写字母数字连字符；core: 件去前缀取 name 段比对——防跨插件冒名，03 §2.7）`,
      );
    }
    const entry: TriggerEntry = { name: def.name, owner: pluginId, description: def.description };
    this.triggers.set(def.name, entry);
    // 注册成功即一次性交接 starter（重装载经重注册重新注入；旧 starter 因 fire
    // 复检悬空失效）。fire 抛错 = 注册未完成：回滚在册面再传播（装载器归
    // PLUGIN_APPLY_FAILED 处置，零半注册残留）
    try {
      def.fire(this.options.makeStarter(pluginId, def.name));
    } catch (err) {
      this.triggers.delete(def.name);
      throw err;
    }
    return () => {
      // 注销器只摘本人条目（防过期时序误摘接任者——registerMessageRole 同守卫）
      if (this.triggers.get(def.name) === entry) this.triggers.delete(def.name);
    };
  }

  /** 在册名单快照（枚举序 = 注册序——测试/审计读侧） */
  list(): readonly TriggerEntry[] {
    return [...this.triggers.values()];
  }
}

/* ---------------- starter 真身（C-3 装配批——起无头会话 + Job 托管编舞） ---------------- */

/** trigger kind 缺省并行帽（03 §2.2 行 108 定形注记——host 装配期自登 kind + 帽 4） */
export const TRIGGER_JOB_PARALLEL_LIMIT = 4;

/** 对话栈结构面（starter 消费的窄面——测试替身免建全栈） */
export interface TriggerStackFace {
  readonly manager: Pick<SessionManager, 'create'>;
  /** 提交入口（fire-and-forget 形——回执经信封回流；无该会话驱动时 undefined） */
  submitText(
    sessionId: string,
    text: string,
    options?: SubmitOptions & { source?: EventSource },
  ): Promise<SubmitResult> | undefined;
}

/** starter 编舞依赖面（装配根注入——结构窄面 + 活体读取源，纯逻辑可测） */
export interface TriggerStarterDeps {
  /** 对话栈消费窄面（起会 + 提交） */
  readonly stack: TriggerStackFace;
  /** Job 注册面（帽与词汇执法在 JobRegistry——受理先于起会） */
  readonly jobs: Pick<JobRegistry, 'register'>;
  /** 开门授予集活体读取源（fire 复检——与注册闸同源，/reload 撤位即拒） */
  readonly getOpens: (pluginId: string) => ReadonlySet<string>;
  /** 工作区根读取（起会 workspaceRoot 选取键——cwd 归一根） */
  readonly workspaceRoot: () => string;
  /** warn 面（拒与失败的可观测位——starter 永不 throw） */
  readonly warn: (message: string) => void;
  /**
   * capability/used 落账位（05 §1.1 触发器腿——U3 批 U3-5 接线）：run 真起
   * 后逐次回调（复检拒/受理失败/起会失败/提交失败不记——没发生的使用不是
   * 使用）；core: 豁免门检但照记（豁免免的是门不是账——§4.6 冷读闸判据）。
   * 缺席 = 诊断形不落账。
   */
  readonly onCapabilityUsed?: (pluginId: string, triggerName: string) => void;
}

/**
 * starter 真身工厂（装配根消费——TriggerRegistry makeStarter 位注入）。
 *
 * 编舞序（受理先行的对称收口——任何一步失败都让 Job 落终态，不留 running
 * 悬空条目）：fire 复检（core: 豁免，拒 = warn + return）→ spec 轻校验 →
 * Job 受理（先过帽再起会）→ 起会（origin 'trigger'）→ 提交（source
 * `plugin:<id>`）→ 回执三终态映射 Job 终态。回执腿 fire-and-forget：starter
 * 同步返回，run 终态经 JobSettledEvent 活体通知可观测。
 */
export function createTriggerStarterFactory(
  deps: TriggerStarterDeps,
): (pluginId: string, name: string) => TriggerStarter {
  return (pluginId, name) => (spec) => {
    // —— fire 复检（03 §4.6 开门可收回）：与注册闸同源活体判——/reload 撤位后
    // 旧 starter 现判现拒；core: 官方件直开豁免（同注册闸判据）
    if (!pluginId.startsWith('core:')) {
      const verdict = adjudicateCapabilityDoor(deps.getOpens(pluginId), 'triggers.start-run');
      if (!verdict.ok) {
        deps.warn(`触发器 ${name} 起会被拒：${verdict.message}（插件 ${pluginId}——fire 复检，开门可收回）`);
        return;
      }
    }
    // —— spec 轻校验（插件代码运行期传参防御——TS 形状之外的运行时防线）
    if (typeof spec.prompt !== 'string' || spec.prompt.length === 0) {
      deps.warn(`触发器 ${name} 起会参数坏形：prompt 缺席或空（插件 ${pluginId}）`);
      return;
    }
    // —— Job 受理先于起会（「fire 受理先过帽再起会话」：帽满 JOB_LIMIT_REACHED /
    // 显式 jobKind 未登记 JOB_KIND_UNKNOWN 都不造孤儿会话）。owner = 插件 id
    // 围栏键（插件卸载 closeOwner(pluginId) 收口——Job 消费面批接线
    // plugin-unload closer）。onStop 协作中止路由（Job 消费面批两桥之一）：
    // stop/closeOwner 置 stopping 后路由到起会驱动的 abort——run 协作中止
    // （aborted 回执 settle killed 与收口兜底 first-wins 竞速，先落者胜）；
    // opened 闭包晚绑（受理先于起会——路由时 opened 必已赋值，防御判空
    // 覆盖 create 抛错后的悬空路由形）
    const title = spec.title ?? `${name} ${new Date().toISOString()}`;
    let opened: OpenedSession | undefined;
    let job: JobHandle;
    try {
      job = deps.jobs.register({
        kind: spec.jobKind ?? 'trigger',
        name: title,
        owner: pluginId,
        onStop: () => {
          opened?.driver.abort();
        },
      });
    } catch (err) {
      deps.warn(
        `触发器 ${name} Job 受理失败（插件 ${pluginId}）：${err instanceof BaseError ? `[${err.code}] ${err.message}` : String(err)}`,
      );
      return;
    }
    // —— 起无头会话（origin 'trigger'；model 纯内存 per-fresh-session 载体）
    try {
      opened = deps.stack.manager.create({
        origin: 'trigger',
        workspaceRoot: deps.workspaceRoot(),
        title,
        ...(spec.model !== undefined ? { model: spec.model } : {}),
      });
    } catch (err) {
      const detail = `起会失败：${err instanceof Error ? err.message : String(err)}`;
      job.settle({ status: 'failed', detail });
      deps.warn(`触发器 ${name} 起会失败（插件 ${pluginId}）：${detail}`);
      return;
    }
    // —— 提交首条输入（source=`plugin:<id>` 归因——05 §3.1 受控注入位）
    const submitted = deps.stack.submitText(opened.sessionId, spec.prompt, { source: `plugin:${pluginId}` });
    if (submitted === undefined) {
      job.settle({ status: 'failed', detail: 'run 未起——会话驱动缺席' });
      deps.warn(`触发器 ${name} 提交失败：会话驱动缺席（插件 ${pluginId}）`);
      return;
    }
    // —— capability/used 逐次落账（05 §1.1——triggers.start-run 腿，C 批挂账
    // U3-5 兑现）：run 真起才算使用；core: 豁免门检照记（豁免免的是门不是账）
    deps.onCapabilityUsed?.(pluginId, name);
    // —— 回执 → Job 终态映射（aborted→killed 承 Job 终态词——SubagentStopReason
    // 同映射；injected/wake-refused 两收执 = run 未起，落 failed 交代去向）
    void submitted.then(
      (result) => {
        if (result.status === 'completed') {
          job.settle({ status: 'completed' });
        } else if (result.status === 'aborted') {
          job.settle({ status: 'killed', detail: 'run 被中止' });
        } else if (result.status === 'failed') {
          job.settle({
            status: 'failed',
            ...(result.errorMessage !== undefined ? { detail: result.errorMessage } : {}),
          });
        } else if (result.status === 'injected') {
          job.settle({
            status: 'failed',
            detail: `run 未起——输入落 inject 通道（durable seq ${result.seq}，随下次启动带入）`,
          });
        } else {
          job.settle({ status: 'failed', detail: 'run 未起——连续后台唤醒超帽拒收（wake-refused）' });
        }
      },
      (err) => {
        job.settle({ status: 'failed', detail: `run 异常：${err instanceof Error ? err.message : String(err)}` });
      },
    );
  };
}
