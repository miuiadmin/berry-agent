/**
 * L2 tools — fs 观察态 CAS（04 §7 fs 族：先读后写结构纪律的判定核心）。
 *
 * 模型对文件的写意图按「观察态 × 当前盘上状态」自动分派（运行时判定，非
 * 模型显式传版本号——模型只须遵守「先 read 后写」工作流）：
 *
 *   从未读过（无记录）   → create-if-absent：目标已在盘上 = 覆盖从未见过的
 *                          内容，FS_NOT_OBSERVED 拒（先 read 观察）；
 *   读过且在（present）  → replace-if-version：当前 stat 指纹与观察指纹一
 *                          致才放行替换，不符 FS_VERSION_CONFLICT（丢失更
 *                          新守卫）；读后文件消失也 FS_VERSION_CONFLICT；
 *   读过且不在（absent） → create-if-absent：读时不存在、此刻却出现 = 他方
 *                          并发创建，FS_VERSION_CONFLICT。
 *
 * edit/delete 额外守卫 requireObservedForEdit：补丁编辑必须基于 present 观
 * 察（未读/读时不在都拒）——补丁是「对已见内容的增量改动」。
 *
 * 与 fence 正交：fence（可写根 containment）管「允不允许写这里」；CAS 管
 * 「写的内容是否基于最新观察」——两关全过才落盘。
 *
 * 观察键语义（04 §7 CAS 段）：登记键 = 用户拼写 abs（resolveTarget 直出
 * ——模型用它拼写过的路径是它心智中的同一文件）；物理写目标 = canonical
 * 键（跨拼写别名在盘上本就同一物——指纹比对的物证面）。
 */
import { BaseError } from '../contracts/index.js';

/** 单文件观察态（per-driver 持有，随会话生命周期） */
export interface ObservedState {
  /** present = 读到过内容（带指纹）；absent = 读时文件不在（此刻创建是合法意图） */
  state: 'present' | 'absent';
  /** 观察时刻的版本指纹（`${size}:${mtimeMs}`）；仅 present 有意义 */
  version?: string;
}

/** 由 stat 产版本指纹——size 与 mtimeMs 组合：内容变更或同尺寸重写都会动 mtime */
export function statVersion(size: number, mtimeMs: number): string {
  return `${size}:${mtimeMs}`;
}

/**
 * 写意图分派结果：
 * - create-if-absent：目标当前不存在才许写（在场即按码拒绝）；
 * - replace-if-version：当前指纹等于观察指纹才许写。
 */
export type WriteIntent = { kind: 'create-if-absent' } | { kind: 'replace-if-version'; expectedVersion: string };

/**
 * 按「观察态 × 当前盘上指纹」分派写意图（判定核心——fs 工具族 write 面
 * 的第一道门；fence 是另一道，先后正交）。
 *
 * @param observed 观察记录（undefined = 从未读过该路径）
 * @param current  当前盘上指纹（undefined = 此刻文件不存在）
 * @returns 分派出的写意图（拒绝时抛 BaseError——码进 message 首缀）
 */
export function resolveWriteIntent(
  observed: ObservedState | undefined,
  current: { version: string } | undefined,
): WriteIntent {
  if (observed === undefined) {
    // 从未读过：在场文件 = 未见过的内容，拒绝覆盖（防盲写）
    if (current !== undefined) {
      throw new BaseError('FS_NOT_OBSERVED', '[FS_NOT_OBSERVED] 目标已存在但从未读取过——拒绝盲写：先 read 观察后再写');
    }
    return { kind: 'create-if-absent' };
  }
  if (observed.state === 'absent') {
    // 读时不在：合法意图是创建；此刻在场 = 他方并发创建，冲突
    if (current !== undefined) {
      throw new BaseError(
        'FS_VERSION_CONFLICT',
        '[FS_VERSION_CONFLICT] 读取时目标不存在、现在却已存在（他方并发创建）：重新 read 后再写',
      );
    }
    return { kind: 'create-if-absent' };
  }
  // present：指纹一致才替换
  if (current === undefined) {
    throw new BaseError('FS_VERSION_CONFLICT', '[FS_VERSION_CONFLICT] 读取后目标已被删除：重新 read 确认意图');
  }
  if (current.version !== observed.version) {
    throw new BaseError(
      'FS_VERSION_CONFLICT',
      `[FS_VERSION_CONFLICT] 目标在读取后被修改（观察 ${observed.version ?? '?'} ≠ 当前 ${current.version}）：重新 read 最新版后再写`,
    );
  }
  return { kind: 'replace-if-version', expectedVersion: current.version };
}

/**
 * edit/delete 意图守卫：必须已读过且在（present）才可动增量面——补丁编辑
 * 的前提是「对已见内容做改动」。指纹校验复用 resolveWriteIntent 的 present
 * 分支（本函数只补「必须已读」这道门）。
 */
export function requireObservedForEdit(
  observed: ObservedState | undefined,
  current: { version: string } | undefined,
): WriteIntent {
  if (observed === undefined || observed.state === 'absent') {
    throw new BaseError(
      'FS_NOT_OBSERVED',
      `[FS_NOT_OBSERVED] 编辑前必须先 read 目标（观察态 ${observed?.state ?? '未读'}不满足补丁编辑前提）`,
    );
  }
  return resolveWriteIntent(observed, current);
}

/**
 * 观察态登记簿：absPath → 观察记录（fs 工具族 per-driver 持有一份，随会话
 * 生命周期；driver 层注册的工具闭包内可达——「会话态工具面」存在理由之一）。
 */
export class ObservedFiles {
  /** 登记表本体（Map——clear 语义需要；无遍历需求故不暴露只读视图） */
  private readonly files = new Map<string, ObservedState>();

  /**
   * 登记「读到内容」。写成功后的观察回填同走此面（写完即最新观察——写后
   * 立即 stat 产指纹登记，紧随的再次写不需重读）。
   */
  observePresent(path: string, version: string): void {
    this.files.set(path, { state: 'present', version });
  }

  /** 登记「读时不存在」（「这里没有文件」也是观察——后续 create 合法） */
  observeAbsent(path: string): void {
    this.files.set(path, { state: 'absent' });
  }

  /** 取观察记录（未读过返回 undefined——写意图分派的入参） */
  get(path: string): ObservedState | undefined {
    return this.files.get(path);
  }

  /** 清空登记簿（测试重置面；产码无清空消费者——观察态随 driver 生命周期自然终结） */
  clear(): void {
    this.files.clear();
  }
}
