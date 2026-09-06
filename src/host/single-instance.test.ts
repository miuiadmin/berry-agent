/**
 * host/single-instance 契约测试——单活跃机 acquire/release 逐路（05 §6.6）。
 *
 * fs/探活/时钟全注入（内存 Map 文件系统）——零真盘依赖纯逻辑覆盖；
 * 组合根级真盘路径由 runtime.test.ts 承（分层惯例）。
 */
import { describe, expect, it } from 'vitest';

import { BaseError } from '../contracts/index.js';

import { acquireActiveMarker, ACTIVE_MARKER_BASENAME } from './single-instance.js';

/** 内存文件系统（单用例新造——隔离） */
function memFs(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  return {
    files,
    ensureDir: (_dir: string) => {},
    writeFile: (path: string, text: string) => files.set(path, text),
    readFile: (path: string) => {
      const text = files.get(path);
      if (text === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return text;
    },
    tryUnlink: (path: string) => files.delete(path),
  };
}

const DIR = '/data';

/** acquire 速记（固定时钟 + 可注探活） */
function acquire(initial: Record<string, string>, alive: (pid: number) => boolean, pid = 101) {
  const fs = memFs(initial);
  const lease = acquireActiveMarker(DIR, {
    pid,
    now: () => 1_700_000_000_000,
    isAlive: alive,
    ...fs,
  });
  return { lease, fs };
}

describe('acquireActiveMarker', () => {
  it('标记缺席 = 首占（tookOver=false）+ 写 pid/时戳记录', () => {
    const { lease, fs } = acquire({}, () => true);
    expect(lease.tookOver).toBe(false);
    expect(lease.record).toEqual({ pid: 101, startedAt: 1_700_000_000_000 });
    const written = fs.files.get(`${DIR}/${ACTIVE_MARKER_BASENAME}`);
    expect(written).toContain('"pid":101');
  });

  it('标记在场且 pid 活 → HOST_DATA_DIR_BUSY 拒入（不打既有进程）', () => {
    const marker = `${JSON.stringify({ pid: 999, startedAt: 1 })}\n`;
    const fs = memFs({ [`${DIR}/${ACTIVE_MARKER_BASENAME}`]: marker });
    expect(() =>
      acquireActiveMarker(DIR, {
        pid: 101,
        now: () => 0,
        isAlive: () => true,
        ...fs,
      }),
    ).toThrowError(/数据目录已有活跃进程（pid 999/); // 报文含既有 pid（诊断面载荷）
    try {
      acquireActiveMarker(DIR, {
        pid: 101,
        now: () => 0,
        isAlive: () => true,
        ...memFs({ [`${DIR}/${ACTIVE_MARKER_BASENAME}`]: marker }),
      });
      expect.unreachable('未拒绝');
    } catch (err) {
      expect(err).toBeInstanceOf(BaseError);
      expect((err as BaseError).code).toBe('HOST_DATA_DIR_BUSY'); // 码身份（惯例 expectCode 形）
    }
  });

  it('标记在场但 pid 死 → 接管覆写（tookOver=true）', () => {
    const marker = `${JSON.stringify({ pid: 999, startedAt: 1 })}\n`;
    const { lease, fs } = acquire({ [`${DIR}/${ACTIVE_MARKER_BASENAME}`]: marker }, () => false);
    expect(lease.tookOver).toBe(true);
    expect(fs.files.get(`${DIR}/${ACTIVE_MARKER_BASENAME}`)).toContain('"pid":101'); // 覆写非追加
  });

  it('坏 JSON 残缺标记 → 视同陈旧接管（宁接管勿误拒）', () => {
    const { lease } = acquire({ [`${DIR}/${ACTIVE_MARKER_BASENAME}`]: '{oops' }, () => true);
    expect(lease.tookOver).toBe(true);
  });

  it('pid 字段缺失/坏形 → 接管', () => {
    const a = acquire({ [`${DIR}/${ACTIVE_MARKER_BASENAME}`]: '{"startedAt":1}' }, () => true);
    expect(a.lease.tookOver).toBe(true);
    const b = acquire({ [`${DIR}/${ACTIVE_MARKER_BASENAME}`]: '{"pid":"x","startedAt":1}' }, () => true);
    expect(b.lease.tookOver).toBe(true);
  });

  it('release 删标记且幂等（二次调用零抛）', () => {
    const { lease, fs } = acquire({}, () => true);
    lease.release();
    expect(fs.files.has(`${DIR}/${ACTIVE_MARKER_BASENAME}`)).toBe(false);
    expect(() => lease.release()).not.toThrow();
  });

  it('数据目录先建后写（ensureDir 在 writeFile 之前被调）', () => {
    const calls: string[] = [];
    acquireActiveMarker(DIR, {
      pid: 1,
      now: () => 0,
      isAlive: () => true,
      ensureDir: () => calls.push('mkdir'),
      writeFile: () => calls.push('write'),
      readFile: () => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      },
      tryUnlink: () => {},
    });
    expect(calls).toEqual(['mkdir', 'write']); // 序执法——目录先在
  });
});
