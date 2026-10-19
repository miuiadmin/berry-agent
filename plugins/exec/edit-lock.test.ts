/**
 * 编辑面跨进程互斥共享原语契约测试（03 §5.3——74 轮件单源共享批）。
 *
 * 同步/异步两形同律镜像：取锁 O_EXCL + pid 载荷、死 pid 残锁破锁不睡重试、
 * 活 pid 有界重试超限 throw EditLockBusy、深目录 mkdir 前置、body 抛错仍
 * 释放锁（finally unlink）。同步形经注入 fs（memFs 桩）；异步形直连真盘
 * （fs/promises 无注入面——tmp 目录同律覆盖）。
 */
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  EDIT_LOCK_RETRY_DEFAULTS,
  EDIT_LOCK_RETRY_INTERVAL_MS,
  EDIT_LOCK_RETRY_MAX_ATTEMPTS,
  EditLockBusy,
  editLockBusyText,
  withEditLock,
  withEditLockAsync,
} from './edit-lock.js';
import type { EditLockFs } from './edit-lock.js';

/** 判死 pid 桩位（真实进程表外——isPidAlive 必折死） */
const DEAD_PID = 999_999_999;

/** memFs 桩（文件 Map——同步形注入面；openExclusive = O_EXCL 探测档） */
function memFs(initial: Record<string, string> = {}): EditLockFs & { files: Map<string, string> } {
  const files = new Map(Object.entries(initial));
  return {
    files,
    read: (path) => files.get(path) ?? null,
    openExclusive: (path, text) => {
      if (files.has(path)) return false; // EEXIST 折在场
      files.set(path, text);
      return true;
    },
    unlink: (path) => {
      files.delete(path); // 缺席静默
    },
    mkdir: () => {}, // memFs 无目录层——空实现（mkdir 前置真身由异步形真盘覆盖）
  };
}

/** tmp 目录清账（异步形真盘腿） */
const cleanups: string[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await rm(cleanups.pop()!, { recursive: true, force: true });
});

describe('编辑锁共享原语·同步形 withEditLock（03 §5.3 74 轮单源共享）', () => {
  it('取得锁 → body 执行 → 释放清场（lockfile 载荷 = 持锁 pid）', () => {
    const fs = memFs();
    const out = withEditLock(fs, '/data/a/enabled.yaml', () => {
      // 临界段内锁在场且载荷 = 本进程 pid
      expect(fs.files.get('/data/a/enabled.yaml.lock')).toBe(`${process.pid}\n`);
      return 42;
    });
    expect(out).toBe(42);
    expect(fs.files.has('/data/a/enabled.yaml.lock')).toBe(false); // finally 释放
  });

  it('死 pid 崩溃残锁 → 破锁立即重试取得（不睡不抛）', () => {
    const fs = memFs({ '/data/enabled.yaml.lock': `${DEAD_PID}\n` });
    const out = withEditLock(fs, '/data/enabled.yaml', () => 'ok');
    expect(out).toBe('ok'); // 残锁不是竞争——破锁重取零等待
    expect(fs.files.has('/data/enabled.yaml.lock')).toBe(false);
  });

  it('活 pid 持锁 → 有界重试超限 throw EditLockBusy（fail-loud 拒锁不静默）', () => {
    const fs = memFs({ '/data/enabled.yaml.lock': `${process.pid}\n` }); // 本进程必活
    const t0 = Date.now();
    expect(() => withEditLock(fs, '/data/enabled.yaml', () => 'unreachable')).toThrow(EditLockBusy);
    // 等待帽真实走过（21 轮 × 100ms ≈ 2.1s——下限 1.5s 防 CI 抖动、上限防悬挂）
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(1500);
    // 他人锁不被破坏（判活在场——只破死锁）
    expect(fs.files.get('/data/enabled.yaml.lock')).toBe(`${process.pid}\n`);
  });

  it('body 抛错 → 锁仍释放（错误照抛不吞）', () => {
    const fs = memFs();
    expect(() =>
      withEditLock(fs, '/data/enabled.yaml', () => {
        throw new Error('body 失败');
      }),
    ).toThrow('body 失败');
    expect(fs.files.has('/data/enabled.yaml.lock')).toBe(false); // finally 释放
  });

  it('拒文 editLockBusyText：载体名 + 锁路径 + 重试帽指路（单源词面四写者族共用）', () => {
    const text = editLockBusyText('启用清单', '/data/enabled.yaml.lock');
    expect(text).toContain('启用清单正被另一进程编辑');
    expect(text).toContain('/data/enabled.yaml.lock');
    expect(text).toContain(`${EDIT_LOCK_RETRY_MAX_ATTEMPTS} 次`);
    expect(text).toContain('已拒写以防丢更新');
  });
});

describe('编辑锁共享原语·异步形 withEditLockAsync（同律镜像——真盘直连）', () => {
  it('取得锁 → body 执行 → 释放清场；锁内载荷 = 持锁 pid', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'berry-editlock-async-'));
    cleanups.push(dir);
    const target = join(dir, 'children.json');
    const out = await withEditLockAsync(target, async () => {
      expect(await readFile(`${target}.lock`, 'utf8')).toBe(`${process.pid}\n`);
      return 'ok';
    });
    expect(out).toBe('ok');
    expect(existsSync(`${target}.lock`)).toBe(false);
  });

  it('深目录首启零文件形 → mkdir 前置建父目录（锁文件同目录先在）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'berry-editlock-deep-'));
    cleanups.push(dir);
    const target = join(dir, 'nested', 'deeper', 'children.json');
    await withEditLockAsync(target, async () => 'ok'); // 不在目录 = 前置建
    expect(existsSync(join(dir, 'nested', 'deeper'))).toBe(true);
    expect(existsSync(`${target}.lock`)).toBe(false);
  });

  it('死 pid 崩溃残锁 → 破锁立即重试取得', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'berry-editlock-stale-'));
    cleanups.push(dir);
    const target = join(dir, 'children.json');
    await writeFile(`${target}.lock`, `${DEAD_PID}\n`, 'utf8');
    const out = await withEditLockAsync(target, async () => 'ok');
    expect(out).toBe('ok');
    expect(existsSync(`${target}.lock`)).toBe(false);
  });

  it('活 pid 持锁 → 有界重试超限 throw EditLockBusy；body 抛错仍释放', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'berry-editlock-busy-'));
    cleanups.push(dir);
    const target = join(dir, 'children.json');
    await writeFile(`${target}.lock`, `${process.pid}\n`, 'utf8'); // 本进程必活
    // 76 轮件6 短帽注入：锁忙分支毫秒级走完（缺省 100ms × 20 真等约 2.1s——
    // 缺省帽行为锁由同步形真等待用例承担，本用例断言面不含时延）
    await expect(
      withEditLockAsync(target, async () => 'unreachable', { retryIntervalMs: 1, maxAttempts: 2 }),
    ).rejects.toBeInstanceOf(EditLockBusy);
    expect(await readFile(`${target}.lock`, 'utf8')).toBe(`${process.pid}\n`); // 他人锁不破
    // 释放腿：取锁后 body 抛错 → finally unlink
    await rm(`${target}.lock`, { force: true });
    await expect(
      withEditLockAsync(target, async () => {
        throw new Error('body 失败');
      }),
    ).rejects.toThrow('body 失败');
    expect(existsSync(`${target}.lock`)).toBe(false);
  });

  it('mkdir 幂等（在场目录重入不抛）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'berry-editlock-mkdir-'));
    cleanups.push(dir);
    await mkdir(dir, { recursive: true }); // 已在场
    const out = await withEditLockAsync(join(dir, 'children.json'), async () => 'ok');
    expect(out).toBe('ok');
  });
});

describe('重试常量注入面（76 轮件6——74 轮「常量注入面收短帽远期」拍板升格）', () => {
  it('短帽注入·同步形：活 pid 锁在场毫秒级折 EditLockBusy（宽松上界防 flake）', () => {
    const fs = memFs({ '/data/enabled.yaml.lock': `${process.pid}\n` }); // 本进程必活
    const t0 = Date.now();
    expect(() =>
      // 注入短帽 1ms × 2——锁忙分支毫秒级走完（缺省 100ms × 20 真等约 2.1s）
      withEditLock(fs, '/data/enabled.yaml', () => 'unreachable', { retryIntervalMs: 1, maxAttempts: 2 }),
    ).toThrow(EditLockBusy);
    // 上界宽松（500ms）防 CI 抖动 flake；短帽常态 3 探 × 1ms 量级
    expect(Date.now() - t0).toBeLessThan(500);
    // 他人活锁不被破坏（短帽只缩等待时长，不破锁语义）
    expect(fs.files.get('/data/enabled.yaml.lock')).toBe(`${process.pid}\n`);
  });

  it('短帽注入·异步形（两形同参数面）：活 pid 锁在场毫秒级折 EditLockBusy', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'berry-editlock-shortcap-'));
    cleanups.push(dir);
    const target = join(dir, 'children.json');
    await writeFile(`${target}.lock`, `${process.pid}\n`, 'utf8'); // 本进程必活
    const t0 = Date.now();
    await expect(
      withEditLockAsync(target, async () => 'unreachable', { retryIntervalMs: 1, maxAttempts: 2 }),
    ).rejects.toBeInstanceOf(EditLockBusy);
    expect(Date.now() - t0).toBeLessThan(500); // 宽松上界防 flake（常态毫秒级）
    expect(await readFile(`${target}.lock`, 'utf8')).toBe(`${process.pid}\n`); // 他人锁不破
  });

  it('缺省恒真常量：注入面缺席两形回落真常量（defaults 恒等断言——行为锁 = 同步形真等待用例 elapsed ≥ 1500ms）', () => {
    // 导出 defaults 恒等断言：注入面回落值与真常量单源同值（缺省行为零变的参数面锚）
    expect(EDIT_LOCK_RETRY_DEFAULTS.retryIntervalMs).toBe(EDIT_LOCK_RETRY_INTERVAL_MS);
    expect(EDIT_LOCK_RETRY_DEFAULTS.maxAttempts).toBe(EDIT_LOCK_RETRY_MAX_ATTEMPTS);
    // 数值钉扎（100ms × 20 ≈ 2s 等待上限——线协议既值，随变即红）
    expect(EDIT_LOCK_RETRY_DEFAULTS).toEqual({ retryIntervalMs: 100, maxAttempts: 20 });
  });

  it('拒文注入值诚实化：带注入参写实际重试值；缺省调用串逐字节不变（四写者族词面基线）', () => {
    // 缺省调用逐字节不变（四写者族共用词面的字节基线——缺省形零漂移）
    expect(editLockBusyText('启用清单', '/data/enabled.yaml.lock')).toBe(
      '启用清单正被另一进程编辑（锁 /data/enabled.yaml.lock，等待重试 20 次 × 100ms 超限）' +
        '——已拒写以防丢更新；确认无其他进程在编辑时，可删除该锁文件后重试',
    );
    // 注入形诚实化：拒文写实际用的重试值（短帽 2 次 × 1ms，非缺省 20 次 × 100ms）
    const text = editLockBusyText('启用清单', '/data/enabled.yaml.lock', { retryIntervalMs: 1, maxAttempts: 2 });
    expect(text).toContain('等待重试 2 次 × 1ms');
    expect(text).not.toContain('20 次');
  });
});
