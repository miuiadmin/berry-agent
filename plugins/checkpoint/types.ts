/**
 * checkpoint 域类型与常量（05 §5.3 批 15d 落码裁决注记——工作区快照/回退）。
 *
 * 快照仓纯文件域（零 SQLite 表、不占迁移号）：`<dataDir>/data/checkpoint/`
 * 下 blobs/（sha256 内容寻址，跨 workspace 共享天然去重）+ manifests/。
 * per-run 一 manifest——机器判据 = 会话末闭合边界较上次捕获时推进（gate.ts）。
 */
import type { GateInput } from '../../src/contracts/index.js';

/** per-workspace manifest 保留份数（裁剪帽——trigger 两形同计；05 §5.3） */
export const CHECKPOINT_RETENTION_PER_WORKSPACE = 10;

/** 单次快照 walk 文件帽（防误指巨型目录炸快照——超帽捕获失败 fail-closed） */
export const CHECKPOINT_WALK_FILE_CAP = 100_000;

/**
 * 单文件字节帽（65 轮件D——捕获面字节维配额）：50 MiB 量级裁量。计数帽
 * 不辖字节维——GB 级单文件无界整读入内存即 OOM 连坐炸宿主。50 MiB 的裁量
 * 理由：常规文本工作区（源码/文档/配置，node_modules 已剪枝）单文件远小于
 * 此量级；越界者多为数据集/媒体/盘映像形，不属于「工作区状态全恢复」的
 * 快照承诺域。超帽 fail-closed 拒快照（CHECKPOINT_CAPTURE_FAILED 响亮回执
 * ——非静默截断）；帽在 walk 枚举面 stat 先行执法（读前拒——读后拒为时
 * 已晚，OOM 已发生）。
 */
export const CHECKPOINT_SINGLE_FILE_BYTE_CAP = 50 * 1024 * 1024;

/**
 * 单快照总量字节帽（65 轮件D）：512 MiB 量级裁量。与文件帽同量级自洽
 * （10 万文件 × 均值 ~5 KiB ≈ 500 MiB）；快照域是文本工作区状态全恢复的
 * 承诺、非备份系统——越界 = 疑似误指巨型目录，同码 fail-closed 拒快照
 * （响亮回执）。帽辖单次快照的 walk 域字节累计（manifest files 各 bytes
 * 之和的上界），blob 内容寻址去重令实际落盘量 ≤ 该账。
 */
export const CHECKPOINT_SNAPSHOT_TOTAL_BYTE_CAP = 512 * 1024 * 1024;

/** manifest 触发形（mutation = 变异前拍；pre-rewind = rewind 段二保底拍） */
export type CheckpointTrigger = 'mutation' | 'pre-rewind';

/** manifest 内单文件条目（path = workspace 相对 posix 形） */
export interface CheckpointFileEntry {
  readonly path: string;
  readonly hash: string;
  readonly bytes: number;
  /**
   * 权限位整理形（stat.mode & 0o777——65 轮件D 写回保真补 mode 维）：可选
   * 位——65 轮件D 之前落册的旧 manifest 缺席 = 回落现状形（restore 不施加
   * chmod，不误伤）；在场时 restore 写回后按位 chmod 还原（0755 脚本不失
   * 执行位、0600 敏感文件不放宽）。
   */
  readonly mode?: number;
}

/** 快照 manifest（快照仓的目录面——files 即恢复清单） */
export interface CheckpointManifest {
  readonly id: string;
  readonly sessionId: string;
  /** fork 回退点（捕获时刻的末闭合边界——05 §5.0 净边界纪律） */
  readonly boundarySeq: number;
  /** workspace 绝对路径（/rewind 按工作区列点的锚） */
  readonly workspaceRoot: string;
  /** 拍摄时刻（epoch ms） */
  readonly capturedAt: number;
  readonly trigger: CheckpointTrigger;
  readonly files: readonly CheckpointFileEntry[];
}

/**
 * 会话语境读面（组合根注入——词面独立律：checkpoint 经 DAG 不可达
 * conversation，GoalJobsFace 同款先例）。lastClosedBoundary 是 per-run
 * 判据与回退点的唯一真源；workspaceRoot 是 manifest 锚。
 */
export interface SessionContextFace {
  /**
   * 会话语境（末闭合边界 seq〔-1 = 无闭合轮——首 run 前形态〕+ 工作区根）。
   * 会话未知返回 undefined（gate 侧放行不拍——非本会话域不越界）。
   */
  contextOf(sessionId: string): { lastClosedBoundary: number; workspaceRoot: string } | undefined;
}

/**
 * fork 面（组合根注入——rewind 三步事务的 fork 腿；05 §5.0 fork 的判别
 * 子集形，SessionManager.fork 可直赋）。adopt 切前台不在此面——焦点编舞
 * 归 host（命令面只回执新会话 id）。
 */
export interface RewindForkFace {
  fork(
    sourceSessionId: string,
    options: { upToSeq: number; title?: string },
  ): Promise<
    | { status: 'forked'; sessionId: string; lineage?: { parentId: string; seedLength: number } }
    | { status: 'vetoed'; reason: string }
  >;
}

/** 守门监听器构造依赖（gate.ts 工厂入参） */
export interface CheckpointGateDeps {
  /** 快照执行面（capture.ts 产物——fail-closed block 的执法体；只产 manifest 或抛） */
  capture(input: {
    sessionId: string;
    boundarySeq: number;
    workspaceRoot: string;
    trigger: CheckpointTrigger;
  }): Promise<CheckpointManifest>;
  /** 会话语境面（组合根注入——判据与锚的唯一来源） */
  session: SessionContextFace;
  /** 诊断面（缺省 console.warn——无锚放行等知情面降级上报） */
  warn?: (message: string) => void;
  /**
   * 拍摄前屏障 seam（05 §5.3 D② 治本批定形注）：对拍 boundarySeq 的会话先
   * 同步排干 write-behind 在队事件，令边界拍下即有 durable 承载（判据边界
   * 取活体日志可领先 durable 日志——不排干即留下「拍后崩溃/毒丸致 durable
   * 永久短于 boundarySeq」的崩溃窗）。真身 = persistence.drainSessionNow
   * 透传（经 host deps 注入）；缺席 = 诚实降级（无持久化环境的测试形态——
   * GoalSessionFace 可选两法同先例）。
   */
  drain?: (sessionId: string) => void;
}

/** 守门载荷的会话键扩展位（04 §7 批 15d 补注——管道透传进守门面） */
export type GateInputWithSession = GateInput & { sessionId?: string };
