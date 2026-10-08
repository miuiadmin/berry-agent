/**
 * host/single-instance 契约测试——单活跃机 acquire/release 逐路（05 §6.6）。
 *
 * fs/探活/时钟全注入（内存 Map 文件系统）——零真盘依赖纯逻辑覆盖；
 * 组合根级真盘路径由 runtime.test.ts 承（分层惯例）。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { BaseError } from '../contracts/index.js';

import { acquireActiveMarker, ACTIVE_MARKER_BASENAME, defaultTryUnlink } from './single-instance.js';

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

describe('竞窗收口 + release 属主比对（挖掘 20 轮）', () => {
  const markerPath = `${DIR}/${ACTIVE_MARKER_BASENAME}`;
  /** ENOENT 形错（注入读缺席用） */
  const enoent = (): Error => Object.assign(new Error('ENOENT'), { code: 'ENOENT' });

  it('读后写前竞窗：他进程已写活标记 → 独占写撞 EEXIST 重判拒入（修前：盲覆写过闸双开）', () => {
    const rival = `${JSON.stringify({ pid: 777, startedAt: 5 })}\n`;
    const files = new Map<string, string>([[markerPath, rival]]); // 竞窗另一端：首读后写前他进程落标
    let firstRead = true;
    try {
      acquireActiveMarker(DIR, {
        pid: 101,
        now: () => 0,
        isAlive: (pid) => pid === 777,
        ensureDir: () => {},
        // 独占语义注入形：在场即抛 code='EEXIST'（缺省 writeFileSync flag 'wx' 同律）
        writeFile: (path, text) => {
          if (files.has(path)) throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' });
          files.set(path, text);
        },
        readFile: () => {
          if (firstRead) {
            firstRead = false; // 首读窗：他进程尚未写（TOCTOU 模拟）
            throw enoent();
          }
          const text = files.get(markerPath);
          if (text === undefined) throw enoent();
          return text;
        },
        tryUnlink: (path) => {
          files.delete(path);
        },
      });
      expect.unreachable('竞窗过闸——未拒入');
    } catch (err) {
      expect(err).toBeInstanceOf(BaseError);
      expect((err as BaseError).code).toBe('HOST_DATA_DIR_BUSY');
      expect((err as Error).message).toContain('777'); // 拒入载荷指向竞窗胜者
    }
    expect(files.get(markerPath)).toBe(rival); // 他人标记不被覆写
  });

  it('竞窗撞陈旧标记（他 pid 死）：清障独占重写接管（tookOver 竞窗对偶）', () => {
    const stale = `${JSON.stringify({ pid: 999, startedAt: 5 })}\n`;
    const files = new Map<string, string>([[markerPath, stale]]);
    let firstRead = true;
    const lease = acquireActiveMarker(DIR, {
      pid: 101,
      now: () => 0,
      isAlive: (pid) => pid === 777, // 999 判死（777 活——防误判全活形）
      ensureDir: () => {},
      writeFile: (path, text) => {
        if (files.has(path)) throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' });
        files.set(path, text);
      },
      readFile: () => {
        if (firstRead) {
          firstRead = false;
          throw enoent(); // 首读窗缺席 → 非接管路径直写 → 撞在场陈旧标
        }
        const text = files.get(markerPath);
        if (text === undefined) throw enoent();
        return text;
      },
      tryUnlink: (path) => {
        files.delete(path);
      },
    });
    expect(lease.tookOver).toBe(true); // 竞窗发现的陈旧标 → 接管语义
    expect(files.get(markerPath)).toContain('"pid":101'); // 清障重写己属
  });

  it('release 只拆己属标记：被他人覆写后不盲拆（修前：盲 unlink 拆掉接管者保护——第三者可入）', () => {
    const fs = memFs(); // 空起始——本进程首占
    const lease = acquireActiveMarker(DIR, {
      pid: 101,
      now: () => 1,
      isAlive: () => true,
      ...fs,
    });
    // 他进程接管覆写（本进程曾被误判死形——注入模拟）
    fs.files.set(markerPath, `${JSON.stringify({ pid: 888, startedAt: 99 })}\n`);
    lease.release();
    expect(fs.files.get(markerPath)).toContain('"pid":888'); // 修前红：盲 unlink → undefined
  });
});

describe('接管腿防误删（挖掘 21 轮件9——首读判死与清障之间的并发接管窗）', () => {
  const markerPath = `${DIR}/${ACTIVE_MARKER_BASENAME}`;
  const enoent = (): Error => Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  /** wx 语义注入形（在场即 EEXIST——缺省 writeFileSync flag 'wx' 同律） */
  const wxWrite = (files: Map<string, string>) => (path: string, text: string) => {
    if (files.has(path)) throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' });
    files.set(path, text);
  };

  it('判活窗内他进程完成接管：清障前重读发现新标 → 拒入且不毁接管者标记（修前：unlink 删活标+wx 空路径成功双开）', () => {
    const stale = `${JSON.stringify({ pid: 999, startedAt: 5 })}\n`;
    const files = new Map<string, string>([[markerPath, stale]]);
    /** 直通桩（B 与 A 的 EEXIST 重判腿共用 files 真态） */
    const passthrough = {
      ensureDir: () => {},
      readFile: () => {
        const text = files.get(markerPath);
        if (text === undefined) throw enoent();
        return text;
      },
      writeFile: wxWrite(files),
      tryUnlink: (path: string) => {
        files.delete(path);
      },
    };
    let bDone = false;
    let a: ReturnType<typeof acquireActiveMarker> | undefined;
    try {
      a = acquireActiveMarker(DIR, {
        pid: 101,
        now: () => 9,
        isAlive: (pid) => {
          // A 的判活窗（isAlive(999) 求值内）：B 同步抢入并完整完成接管
          // （读 stale 判死 → 清障 → 独占写己标——B 持锁）
          if (pid === 999 && !bDone) {
            bDone = true;
            acquireActiveMarker(DIR, { pid: 202, now: () => 7, isAlive: (p) => p === 202, ...passthrough });
          }
          return pid === 101 || pid === 202; // 999 判死；101/202 活
        },
        ...passthrough,
      });
      expect.unreachable('接管腿盲清障——双开过闸');
    } catch (err) {
      expect(err).toBeInstanceOf(BaseError);
      expect((err as BaseError).code).toBe('HOST_DATA_DIR_BUSY');
      expect((err as Error).message).toContain('202'); // 拒入载荷指向并发接管胜者
    }
    // B 的标记不被 A 的清障毁掉（修前红：A unlink 删 B 标 + wx 空路径直入）
    expect(files.get(markerPath)).toContain('"pid":202');
    expect(a).toBeUndefined();
  });
});

describe('defaultTryUnlink（缺省实现 fail-loud——第十五役 α4 修）', () => {
  it('ENOENT 幂等静默；非 ENOENT（目录路径 EPERM/EISDIR）上抛', () => {
    // 缺省实现此前裸 catch 全吞、与注释「其余错上抛」相悖——吞 EACCES/EROFS
    // 类错会把「标记清不掉」伪装成「已清」。真盘直测：缺席文件静默、
    // 目录路径（unlink 恒抛非 ENOENT——darwin EPERM / linux EISDIR）上抛。
    const dir = mkdtempSync(join(tmpdir(), 'berry-unlink-'));
    try {
      expect(() => defaultTryUnlink(join(dir, 'absent.json'))).not.toThrow(); // ENOENT 幂等
      expect(() => defaultTryUnlink(dir)).toThrow(); // 非 ENOENT 上抛（修前裸吞 → 红）
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
