/**
 * 子进程登记簿（04 §11：全部 spawn 子进程入册；写面容错；孤儿清扫）。
 *
 * 四语义：
 * - **写面容错**：登记/出册的持久化失败降 warn 不抛——「登记丢失不损执行
 *   正确性」，杀树退化为已知 pid 集兜底；持久化走 tmp+rename 原子写（半写
 *   文件不进正身）。
 * - **锁内增量持久化**（03 §5.3 74 轮件1 批注——跨进程丢更新防护）：内存
 *   Map 是本进程视图、children.json 是多宿主并集账——持久化不以己方快照
 *   整覆写，每笔 = 异步编辑锁（withEditLockAsync——本件 edit-lock.ts 单源
 *   共享原语）→ 锁内重读文件并集账 → 施增量（add=upsert 单条 / remove=
 *   出册单条）→ tmp+rename 写回；锁不可得 = warn 跳过本笔不丢账（内存账
 *   仍准确，下笔自愈），绝不退化为无锁写。
 * - **孤儿清扫**（启动期一次）：读残留册，上代宿主已死（entry.hostPid 判
 *   活）→ 验命令行（pid 复用防线——命令行与登记 argv 不符即跳过，杀错无
 *   辜进程比漏杀孤儿更糟）→ 树杀 → 出册 → 收尾投影恰一笔汇总行
 *   （[EXEC_ORPHAN_SWEEP] 标签——04 §11 73 轮批注「清扫回执呈现链兑现」）。
 *   残留条目回填走 backfill（纯内存写零持久化——回填即重写文件会以启动期
 *   快照洗掉并发实例的活账）。
 * - **stale 判定**：清扫只认「宿主已死」的条目；宿主仍活的条目是并发实例
 *   的活账，不动。
 */
import { rename, readFile, writeFile } from 'node:fs/promises';
import { createLogger } from '../../src/context/index.js';
import type { Logger } from '../../src/context/index.js';
import { EditLockBusy, withEditLockAsync } from './edit-lock.js';
import type { ProcessEntry, RegistryWithBackfill, SweepDeps } from './types.js';

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
 * 持久化增量（锁内重读后施于文件并集账的单笔动作——进程内存视图不出镜：
 * 以己方快照整覆写会洗掉他进程已落账条目）。
 */
type PersistIncrement =
  { readonly kind: 'add'; readonly entry: ProcessEntry } | { readonly kind: 'remove'; readonly pid: number };

/**
 * 建子进程登记簿。内存 Map 是本进程唯一真相源，文件是多宿主并集的崩溃
 * 恢复账——写路径全容错（任何一步失败 warn 后照常返回，调用方无感）。
 */
export function createProcessRegistry(options: RegistryOptions = {}): RegistryWithBackfill {
  const logger = options.logger ?? createLogger('exec');
  const entries = new Map<number, ProcessEntry>();
  /** 持久化串行链（写-写竞态防线——见 persist 注记） */
  let persistChain: Promise<void> = Promise.resolve();

  // 持久化（锁内增量 + tmp+rename 原子写；全链容错——04 §11「写面容错」条款）。
  // 串行化关键：多次 add/remove 各自 fire-and-forget 会并发施增量争用同一
  // 临界段；承诺链按入队序逐笔落锁，文件终态收敛。tmp 带 pid 后缀防跨进程
  // 互截（同 pid 内由串行链保序，跨进程由编辑锁互斥——两防线正交）
  const persist = (increment: PersistIncrement): void => {
    if (options.filePath === undefined) return;
    const filePath = options.filePath;
    const tmp = `${filePath}.tmp-${process.pid}`;
    persistChain = persistChain.then(async () => {
      try {
        await withEditLockAsync(filePath, async () => {
          // 锁内重读文件并集账：缺席（ENOENT）= 空账起步；坏 JSON/非数组形
          // = warn 跳过本笔不覆写（覆写会把坏形洗成「恰好等于己方增量」的
          // 好形账——丢并发实例条目比留坏形更坏；下笔自愈）
          let onDisk: ProcessEntry[] = [];
          try {
            const raw = await readFile(filePath, 'utf8');
            const parsed: unknown = JSON.parse(raw);
            if (Array.isArray(parsed)) onDisk = parsed as ProcessEntry[];
            else {
              logger.warn('登记簿文件坏形——本笔持久化跳过不覆写（下笔自愈）', { filePath });
              return;
            }
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
              logger.warn('登记簿文件坏形——本笔持久化跳过不覆写（下笔自愈）', { filePath });
              return;
            }
          }
          // 施增量（文件并集账上单条 upsert / 单条出册——内存 Map 不出镜）
          if (increment.kind === 'add') {
            onDisk = onDisk.filter((e) => e.pid !== increment.entry.pid);
            onDisk.push(increment.entry);
          } else {
            onDisk = onDisk.filter((e) => e.pid !== increment.pid);
          }
          // 敏感产物落盘 0600（05 §6.6——2026-10-18 60 轮 L2 批扩列）：登记簿
          // 是全量 argv 审计面，建即 0600——mode 落 tmp 写位、随 rename 承袭
          // 终名；「建即」辖建时点，在场旧文件不追溯。
          await writeFile(tmp, `${JSON.stringify(onDisk satisfies RegistryFile)}\n`, {
            encoding: 'utf8',
            mode: 0o600,
          });
          await rename(tmp, filePath);
        });
      } catch (error) {
        if (error instanceof EditLockBusy) {
          // 锁不可得（重试超限）= 跳过本笔不丢账：内存账仍准确、下笔自愈
          // ——绝不退化为无锁写（丢并发实例落账比暂缓落盘更坏）
          logger.warn('登记簿编辑锁重试超限——本笔持久化跳过不丢账（内存账仍准确，下笔自愈）', {
            filePath,
            lockPath: error.lockPath,
          });
          return;
        }
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
      persist({ kind: 'add', entry });
    },
    remove(pid) {
      // 幂等出册（结算可能后于清扫——缺席即无事）
      if (!entries.delete(pid)) return;
      persist({ kind: 'remove', pid });
    },
    backfill(entry) {
      // 纯内存写零持久化（sweep 回填专用——见接口注记）
      entries.set(entry.pid, entry);
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
 * 先把残留条目回填进内存账再逐条裁——直接 remove 未回填条目会出册无账可出
 * （内存快照空）。回填走 backfill（零持久化）：并发活实例的账本不因本进程
 * 启动清扫而被重写。
 * @param registry 登记簿（RegistryWithBackfill——回填腿由此进）
 * @param options 构造同形选项（filePath/logger/hostPid）
 * @param deps 判活/命令行/树杀依赖面（注入桩可测；装配批接真实现）
 */
export async function sweepOrphans(
  registry: RegistryWithBackfill,
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
  // 残留条目回填内存账（backfill 零持久化——stale 条目随裁剪出册走增量单条）
  for (const entry of persisted) registry.backfill(entry);
  let killed = 0;
  let skipped = 0;
  let removed = 0;
  // 被杀条目随行账（pid + 命令行——收尾汇总行的审计载荷）：children.json
  // 增量落账后前态不可考，进程日志是树杀动作唯一可审计面（04 §11 73 轮批注）
  const killedEntries: { pid: number; cmdline: string }[] = [];
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
      killedEntries.push({ pid: entry.pid, cmdline: expected });
    }
    registry.remove(entry.pid);
    removed += 1;
  }
  // 清扫收尾投影（04 §11 73 轮批注「清扫回执呈现链兑现」）：killed/removed
  // 任一非零 → 恰一笔汇总行（计数 + 被杀条目 pid/命令行随行）——「上代崩溃
  // 遗留孤儿被本代树杀 N 个」与「无孤儿」由此在进程日志可分辨（无人值守
  // 产品对进程组 SIGKILL 须有痕迹可审计）。行首标签 [EXEC_ORPHAN_SWEEP]
  // 是日志标签形（承 [MEMORY_CYCLE_REVIEW]/[SCHEDULER_POLL_ERRORS] 先例
  // ——非 durable 事件词不入词汇表）；全零 = 无孤儿常态零投影零噪声。
  if (killed > 0 || removed > 0) {
    const tail =
      killedEntries.length > 0
        ? `——被杀条目 ${killedEntries.map((e) => `pid=${e.pid} cmd="${e.cmdline}"`).join('；')}`
        : '';
    logger.warn(`[EXEC_ORPHAN_SWEEP] 上代遗留孤儿清扫收尾：树杀 ${killed}、跳过 ${skipped}、出册 ${removed}${tail}`);
  }
  return { killed, skipped, removed };
}
