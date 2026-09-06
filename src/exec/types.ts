/**
 * exec 件公共类型（04 §11 spawn 管道 + 04 §8 bash 工具件）。
 *
 * 本件是 core:exec 插件的纯逻辑腿：spawn 管道（失败二分/进程组树杀/超时
 * 归因/保尾/env 白名单）+ 子进程登记簿 + bash 工具件工厂 + environment
 * 披露段的 git 摘要件。装载态集成（scope.provide('exec', …) 供给
 * conversation 的 ExecToolService 结构契约——见 conversation/types.ts，本件
 * 刻意不 import 对端：conversation 边表不可达 exec，契约单源在对端）归
 * 批 12 装载面后装配批。
 */

/** 输出保尾预算（04 §11：stdout/stderr 合计 60KiB 截尾保后半——尾部才有失败现场） */
export const OUTPUT_TAIL_BYTES = 60 * 1024;

/** bash 工具超时缺省与上限（04 §8：缺省 120s、上限 600s） */
export const BASH_TIMEOUT_DEFAULT_MS = 120_000;
export const BASH_TIMEOUT_MAX_MS = 600_000;

/**
 * 结算归因（04 §11 超时归因先到先得）：timeout / 打断（abort）/ 自然退出
 * （exit）三源竞速，先到者落归因即封——result 只带一个归因，不双报。
 */
export type ExecOutcome = 'exit' | 'timeout' | 'abort';

/** 子进程登记簿条目（04 §11：pid/命令/归属；hostPid 供孤儿清扫判活） */
export interface ProcessEntry {
  /** 子进程 pid */
  readonly pid: number;
  /** 完整 argv（登记即审计面——杀前验命令行的比对源） */
  readonly argv: readonly string[];
  /** 归属（工具调用 id / 桥名——「谁开的」） */
  readonly owner: string;
  /** 发起方（berry-agent 宿主进程）pid——孤儿清扫判活锚 */
  readonly hostPid: number;
  /** 发起时刻（epoch ms） */
  readonly startedAt: number;
}

/** env 白名单策略（04 §11 deny-by-default：默认零继承，声明式变更表） */
export interface EnvPolicy {
  /** allow 白名单——仅这些变量从宿主环境继承（缺省见 DEFAULT_ENV_ALLOW） */
  readonly allow?: readonly string[];
  /** deny 覆盖——deny 命中 allow/set 任一面即抛 EXEC_ENV_FORBIDDEN（拒静默继承） */
  readonly deny?: readonly string[];
  /** 显式注入（内部调用方——桥接进程协议变量等；仍受 deny 封死） */
  readonly set?: Readonly<Record<string, string>>;
}

/** spawn 请求（管道唯一入口形；bash 工具与后续桥件共用） */
export interface SpawnRequest {
  /** 完整 argv（含可执行；受沙箱时为 confine 产物） */
  readonly argv: readonly string[];
  /** 工作目录（缺省进程 cwd） */
  readonly cwd?: string;
  /** 超时预算 ms（缺省无超时——bash 工具面有缺省 120s；到点进程组树杀） */
  readonly timeoutMs?: number;
  /** 外部中止信号（协作面——三源竞速的打断源；结算即摘监听） */
  readonly signal?: AbortSignal;
  /** env 白名单策略（缺省 DEFAULT_ENV_ALLOW、零继承宿主其余变量） */
  readonly env?: EnvPolicy;
  /** 登记簿归属（缺省 'exec'；bash 工具传工具调用 id） */
  readonly owner?: string;
}

/** spawn 结算产物（失败二分：spawn 阶段失败走 BaseError 抛出，不走本形） */
export interface ExecResult {
  /** 结算归因（先到先得唯一值） */
  readonly outcome: ExecOutcome;
  /** 退出码（outcome ≠ 'exit' 时为 null——被杀无有意义的退出码） */
  readonly exitCode: number | null;
  /** stdout 保尾段（UTF-8 宽容解码——诊断面非数据面，见 tail.ts 注记） */
  readonly stdout: string;
  /** stderr 保尾段 */
  readonly stderr: string;
  /** 两流合计是否有丢弃（触 60KiB 帽） */
  readonly truncated: boolean;
  /** 两流合计实收字节数（含已丢弃——真实体量，超帽披露用） */
  readonly bytes: number;
  /** 存续时长 ms（结算时钟差） */
  readonly durationMs: number;
}

/**
 * 子进程登记簿面（04 §11：全部 spawn 子进程入册；写面容错——登记失败降
 * warn 不抛，登记丢失不损执行正确性）。
 */
export interface ProcessRegistry {
  /** 入册（spawn 成功后调用；内部容错） */
  add(entry: ProcessEntry): void;
  /** 出册（进程结算后调用；幂等） */
  remove(pid: number): void;
  /** 当前在册快照（孤儿清扫与诊断面消费） */
  list(): readonly ProcessEntry[];
}

/** 孤儿清扫依赖面（判活/命令行读取/树杀——注入桩可测） */
export interface SweepDeps {
  /** pid 判活（posix 惯例 kill(pid, 0)） */
  readonly isAlive: (pid: number) => boolean;
  /** 读进程命令行（杀前验命令行——pid 复用防线；读不到返回 null 视为不匹配） */
  readonly readCmdline: (pid: number) => string | null;
  /** 进程组树杀（posix kill(-pgid)；win32 taskkill /T） */
  readonly killTree: (pid: number) => void;
}

/** spawn 管道面（bash 工具与后续 MCP/LSP/browser 三桥共用的执行真身） */
export interface SpawnPipeline {
  /** 唯一入口：spawn → 登记 → 三源竞速结算 → 保尾产出（04 §11 编排序全腿） */
  run(request: SpawnRequest): Promise<ExecResult>;
  /** 子进程登记簿（宿主启动期孤儿清扫消费） */
  readonly registry: ProcessRegistry;
}
