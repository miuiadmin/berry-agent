/**
 * 子进程登记簿（04 §11：全部 spawn 子进程入册；写面容错；孤儿清扫）。
 *
 * 三语义：
 * - **写面容错**：登记/出册的持久化失败降 warn 不抛——「登记丢失不损执行
 *   正确性」，杀树退化为已知 pid 集兜底；持久化走 tmp+rename 原子写（半写
 *   文件不进正身）。
 * - **孤儿清扫**（启动期一次）：读残留册，上代宿主已死（entry.hostPid 判
 *   活）→ 验命令行（pid 复用防线——命令行与登记 argv 不符即跳过，杀错无
 *  辜进程比漏杀孤儿更糟）→ 树杀 → 出册。
 * - **stale 判定**：清扫只认「宿主已死」的条目；宿主仍活的条目是并发实例
 *   的活账，不动。
 */
import { rename, readFile, writeFile } from 'node:fs/promises';
import { createLogger } from '../context/index.js';
import type { Logger } from '../context/index.js';
import type { ProcessEntry, ProcessRegistry, SweepDeps } from './types.js';

/** 登记簿构造依赖（全部可注入——测试面零真实文件） */
export interface RegistryOptions {
  /** 持久化文件路径（缺席 = 纯内存账——不持久化也不清扫；装配批接数据目录） */
  readonly filePath?: string;
  /** logger（缺省 exec 模块 logger） */
  readonly logger?: Logger;
  /** 本宿主 pid（缺省 process.pid——孤儿判定锚） */
  readonly hostPid?: number;
  /** 时间源（缺省 Date.now） */
  readonly now?: () => number;
}

/** 登记簿文件形（数组顶层——前向兼容面只增字段） */
type RegistryFile = readonly ProcessEntry[];

/**
 * 建子进程登记簿。内存 Map 是唯一真相源，文件是崩溃恢复账——写路径全容错
 * （任何一步失败 warn 后照常返回，调用方无感）。
 */
export function createProcessRegistry(options: RegistryOptions = {}): ProcessRegistry {
  const logger = options.logger ?? createLogger('exec');
  const entries = new Map<number, ProcessEntry>();
  /** 持久化串行链（写-写竞态防线——见 persist 注记） */
  let persistChain: Promise<void> = Promise.resolve();

  // 持久化（tmp+rename 原子写；全链容错——04 §11「写面容错」条款）。
  // 串行化关键：多次 add/remove 各自 fire-and-forget 会并发争用同一 tmp 路径
  // （先到 rename 可吞后到写入——终态倒退成旧快照）；承诺链按入队序逐笔落盘，
  // 末笔即最新快照，文件终态收敛
  const persist = (snapshot: readonly ProcessEntry[]): void => {
    if (options.filePath === undefined) return;
    const filePath = options.filePath;
    const tmp = `${filePath}.tmp`;
    persistChain = persistChain.then(async () => {
      try {
        await writeFile(tmp, `${JSON.stringify(snapshot satisfies RegistryFile)}\n`, 'utf8');
        await rename(tmp, filePath);
      } catch (error) {
        logger.warn('登记簿持久化失败（容错降级——内存账仍准确）', {
          filePath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  };

  return {
    add(entry) {
      entries.set(entry.pid, entry);
      persist([...entries.values()]);
    },
    remove(pid) {
      // 幂等出册（结算可能后于清扫——缺席即无事）
      if (!entries.delete(pid)) return;
      persist([...entries.values()]);
    },
    list() {
      return [...entries.values()];
    },
  };
}

/** 清扫产物（宿主启动期一次；诊断/审计面） */
export interface SweepReport {
  /** 树杀的孤儿数 */
  readonly killed: number;
  /** 命令行不符跳过数（pid 复用嫌疑——不杀） */
  readonly skipped: number;
  /** 清理出册的残留条目总数（含孤儿与已死进程条目） */
  readonly removed: number;
}

/**
 * 启动期孤儿清扫（04 §11：扫残留册、hostPid 判活、验命令行、树杀）。
 * 读文件失败（无文件/坏 JSON）= 空册起步 + warn——清扫是恢复面不是启动门槛。
 *
 * 先把残留条目回填进内存账再逐条裁——直接 remove 未回填条目会把内存快照
 * （空）持久化、误抹并发活实例的账本。
 * @param deps 判活/命令行/树杀依赖面（注入桩可测；装配批接真实现）
 */
export async function sweepOrphans(
  registry: ProcessRegistry,
  options: RegistryOptions,
  deps: SweepDeps,
): Promise<SweepReport> {
  const logger = options.logger ?? createLogger('exec');
  const hostPid = options.hostPid ?? process.pid;
  let persisted: ProcessEntry[] = [];
  if (options.filePath !== undefined) {
    try {
      const raw = await readFile(options.filePath, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) persisted = parsed as ProcessEntry[];
    } catch {
      logger.warn('登记簿文件缺失/坏形——空册起步（清扫恢复面非启动门槛）', {
        filePath: options.filePath,
      });
      return { killed: 0, skipped: 0, removed: 0 };
    }
  }
  // 残留条目回填内存账（stale 条目随裁剪出册——持久化走内存快照单源）
  for (const entry of persisted) registry.add(entry);
  let killed = 0;
  let skipped = 0;
  let removed = 0;
  // 裁剪对象 = 回填后的整本账（内存既有 + 文件残留——启动期内存通常为空，
  // 但纯内存腿调用〔无 filePath〕同样可扫）
  for (const entry of registry.list()) {
    // 宿主仍活：并发实例的活账，不动（stale 判定——只清上代遗产）
    if (entry.hostPid === hostPid || deps.isAlive(entry.hostPid)) continue;
    // 孤儿谱系：进程本身已死则纯出册；活着则验命令行再树杀（pid 复用防线）
    if (deps.isAlive(entry.pid)) {
      const cmdline = deps.readCmdline(entry.pid);
      const expected = entry.argv.join(' ');
      if (cmdline === null || !cmdline.includes(expected)) {
        skipped += 1;
        logger.warn('孤儿命令行不符——pid 复用嫌疑跳过树杀（宁漏杀孤儿不误杀无辜）', {
          pid: entry.pid,
          expected,
        });
        continue;
      }
      deps.killTree(entry.pid);
      killed += 1;
    }
    registry.remove(entry.pid);
    removed += 1;
  }
  return { killed, skipped, removed };
}
