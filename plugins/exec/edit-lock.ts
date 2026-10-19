/**
 * 编辑面跨进程互斥共享原语（03 §5.3 编辑面跨进程互斥律——挖掘 74 轮批注
 * 单源共享）：enabled.yaml / ledger.json / 源清单 marketplaces.json / 子进程
 * 登记簿 children.json 四写者族同协议同款 lockfile。
 *
 * 协议（同步/异步两形同律——线协议兼容：同 lockfile 路径约定
 * `<目标文件>.lock`、同 pid 载荷形 `${process.pid}\n`、同常量）：
 *  - 取锁 = O_EXCL 独占建文件（载荷 = 持锁 pid——stale 判定锚）；
 *  - 在场 = 读持锁 pid 判活（isPidAlive——信号 0 探测 ESRCH 折死）：活 =
 *    有界等待重试（约 100ms × 20 帽）；死 = 崩溃残锁破锁**立即重试不睡**
 *    （残锁不是竞争）；内容不可解析 = 保守按活（无法证明 stale 即不破，
 *    超限兜底）；
 *  - 破锁-重取竞窗自愈：unlink 后 O_EXCL 重试，失败（对方先取得）则重读
 *    重判（unlink 缺席静默语义由 fs 面承载）；
 *  - 互斥不可得（重试超限）= throw EditLockBusy——调用腿折各自的失败回执
 *    形（host 写者族 fail-loud 拒写；登记簿持久化链 warn 降级跳过下笔自愈）；
 *  - 释放 = finally unlink（缺席静默——外扰清场后的幂等收口）。
 *
 * 同进程重入（嵌套写者）无自持锁豁免：自身 pid 判活走等待支，超限即拒——
 * 该形是防御位（持锁写者临界段内嵌套写同目标 = 后到者诚实拒，绝不无锁写）。
 *
 * 两变体：
 *  - **同步形** withEditLock（fs 注入面 EditLockFs）：host 短命 CLI/回合内
 *    写动词消费；重试睡眠 Atomics.wait（等待期短、进程形态容忍阻塞）。
 *  - **异步形** withEditLockAsync（node:fs/promises 直连）：异步持久化链
 *    消费（子进程登记簿）；重试 sleep 用 setTimeout Promise——禁 Atomics.wait
 *    阻塞事件循环（TUI 宿主面不可接受）。
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { isPidAlive } from './spawn.js';

/** 锁重试间隔（有界等待帽的粒度——两形同常量） */
export const EDIT_LOCK_RETRY_INTERVAL_MS = 100;
/** 锁重试次数帽（100ms × 20 ≈ 2s 等待上限——超限折调用腿失败回执形） */
export const EDIT_LOCK_RETRY_MAX_ATTEMPTS = 20;

/**
 * 编辑锁超限拒绝（withEditLock/withEditLockAsync 取锁失败档的内部载体）：
 * 各写腿 catch 后折本腿失败形（行动词折 result 面拒文、账本腿折 BaseError
 * 拒抛、登记簿持久化链折 warn 跳过）——不外泄类形，「宁拒服务不丢数据」的
 * message 才是呈现面。
 */
export class EditLockBusy extends Error {
  constructor(readonly lockPath: string) {
    super(`编辑锁重试超限：${lockPath}`);
  }
}

/**
 * 锁超限拒文单源（带锁路径与重试帽——消费载体经 name 位传名：启用清单 /
 * 装机账本 / 市场源清单）。词面模板四写者族共用，漂移即测试红；「宁拒服务
 * 不丢数据」与锁文件定位/清锁指路是拒文的承载面。
 */
export function editLockBusyText(name: string, lockPath: string): string {
  return (
    `${name}正被另一进程编辑（锁 ${lockPath}，等待重试 ${EDIT_LOCK_RETRY_MAX_ATTEMPTS} 次 × ` +
    `${EDIT_LOCK_RETRY_INTERVAL_MS}ms 超限）——已拒写以防丢更新；确认无其他进程在编辑时，可删除该锁文件后重试`
  );
}

/**
 * 同步形锁 fs 面（PluginStoreFs 的锁原语子集——结构兼容直传；市场层
 * MarketFs 经适配折入）：read 缺席 = null；openExclusive = O_EXCL 单发探测
 * （true = 建成即持锁 / false = 在场 EEXIST 折档不抛）；unlink = 删单文件
 * （缺席静默）；mkdir = 递归建目录（首启零文件形锁文件同目录先在）。
 */
export interface EditLockFs {
  readonly read: (path: string) => string | null;
  readonly openExclusive: (path: string, text: string) => boolean;
  readonly unlink: (path: string) => void;
  readonly mkdir: (path: string, options: { readonly recursive: true }) => void;
}

/**
 * 同步睡眠（Atomics.wait——同步形锁重试等待专用；异步形禁用——阻塞事件
 * 循环于 TUI 宿主不可接受）。
 */
function lockSleepSync(ms: number): void {
  const cell = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(cell, 0, 0, ms);
}

/**
 * 编辑面跨进程互斥原语·同步形：包住「读 → 改 → 写回」**整段** RMW（只罩
 * 原子写不够——A 读 → B 读 → B 写 → A 写的交错丢更新发生在读位与写位
 * 之间）。见文件头「协议」节。
 */
export function withEditLock<T>(fs: EditLockFs, targetPath: string, body: () => T): T {
  const lockPath = `${targetPath}.lock`;
  // 锁文件同目录先在（首启零文件形：目标文件的父目录由本笔前置建——
  // recursive 幂等）
  fs.mkdir(dirname(targetPath), { recursive: true });
  let attempts = 0;
  for (;;) {
    if (fs.openExclusive(lockPath, `${process.pid}\n`)) break; // 取得——进临界段
    const held = fs.read(lockPath);
    const pid = held === null ? Number.NaN : Number(held.trim());
    // stale 判定（pid 判死 = 崩溃残锁）：破锁立即重试（不睡——残锁不是竞争）
    if (Number.isInteger(pid) && pid > 0 && !isPidAlive(pid)) {
      fs.unlink(lockPath);
      continue;
    }
    if (++attempts > EDIT_LOCK_RETRY_MAX_ATTEMPTS) throw new EditLockBusy(lockPath);
    lockSleepSync(EDIT_LOCK_RETRY_INTERVAL_MS);
  }
  try {
    return body();
  } finally {
    fs.unlink(lockPath);
  }
}

/* ---------------- 异步形（登记簿持久化链消费） ---------------- */

/** O_EXCL 单发探测（异步直连形——EEXIST 折 false 在场探测档，其余照抛） */
async function openExclusiveAsync(path: string, text: string): Promise<boolean> {
  try {
    await writeFile(path, text, { flag: 'wx' });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
}

/** 读文本缺席折 null（持锁 pid 载荷读取——其余错误同折 null 走保守按活支） */
async function readFileOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

/** 异步睡眠（setTimeout Promise——不阻塞事件循环） */
function sleepAsync(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 编辑面跨进程互斥原语·异步形：协议与同步形逐条同律（同 lockfile 路径、
 * 同 pid 载荷、同常量、破锁不睡重试、finally 释放）；差别只在 IO 走
 * node:fs/promises 与重试 sleep 不阻塞事件循环。直连真盘（异步持久化链
 * 无 fs 注入面——测试经真盘 tmp 目录同律覆盖）。
 */
export async function withEditLockAsync<T>(targetPath: string, body: () => Promise<T>): Promise<T> {
  const lockPath = `${targetPath}.lock`;
  // 锁文件同目录先在（与同步形同律——recursive 幂等）
  await mkdir(dirname(targetPath), { recursive: true });
  let attempts = 0;
  for (;;) {
    if (await openExclusiveAsync(lockPath, `${process.pid}\n`)) break; // 取得——进临界段
    const held = await readFileOrNull(lockPath);
    const pid = held === null ? Number.NaN : Number(held.trim());
    // stale 判定（pid 判死 = 崩溃残锁）：破锁立即重试（不睡——残锁不是竞争）
    if (Number.isInteger(pid) && pid > 0 && !isPidAlive(pid)) {
      await rm(lockPath, { force: true }); // 缺席静默（竞窗里对方可能已清）
      continue;
    }
    if (++attempts > EDIT_LOCK_RETRY_MAX_ATTEMPTS) throw new EditLockBusy(lockPath);
    await sleepAsync(EDIT_LOCK_RETRY_INTERVAL_MS);
  }
  try {
    return await body();
  } finally {
    await rm(lockPath, { force: true }); // 释放（缺席静默——幂等收口）
  }
}
