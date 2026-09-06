/**
 * checkpoint 域类型与常量（05 §5.3 批 15d 落码裁决注记——工作区快照/回退）。
 *
 * 快照仓纯文件域（零 SQLite 表、不占迁移号）：`<dataDir>/data/checkpoint/`
 * 下 blobs/（sha256 内容寻址，跨 workspace 共享天然去重）+ manifests/。
 * per-run 一 manifest——机器判据 = 会话末闭合边界较上次捕获时推进（gate.ts）。
 */
import type { GateInput } from '../contracts/index.js';

/** per-workspace manifest 保留份数（裁剪帽——trigger 两形同计；05 §5.3） */
export const CHECKPOINT_RETENTION_PER_WORKSPACE = 10;

/** 单次快照 walk 文件帽（防误指巨型目录炸快照——超帽捕获失败 fail-closed） */
export const CHECKPOINT_WALK_FILE_CAP = 100_000;

/** manifest 触发形（mutation = 变异前拍；pre-rewind = rewind 段二保底拍） */
export type CheckpointTrigger = 'mutation' | 'pre-rewind';

/** manifest 内单文件条目（path = workspace 相对 posix 形） */
export interface CheckpointFileEntry {
  readonly path: string;
  readonly hash: string;
  readonly bytes: number;
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
}

/** 守门载荷的会话键扩展位（04 §7 批 15d 补注——管道透传进守门面） */
export type GateInputWithSession = GateInput & { sessionId?: string };
