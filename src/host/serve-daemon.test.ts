/**
 * host/serve-daemon 编舞测试（批 13e-3）。
 *
 * 三动词分测——status/stop 全注入（假 fs/时钟/探活/信号——编舞纯逻辑零真
 * 进程）；spawner 注入假 spawn 面（argv/env/CHILD 标记收账，不触真 fs）；
 * daemon child 主体走真件集成（真 runtime 真库 tmpdir + 真 createSdkHttpFace
 * + faux provider——承 serve-entry.test 同款组合根形态；face 本体 22 例单测
 * 在 sdk/http.test，此处锁编舞接线：pid 登记/token 披露/优雅停清足迹）。
 *
 * 真 spawn 真进程集成不在此（vitest 无 dist/tsx 直跑运行态）——实机联调归
 * 批 13e-3 落地后手动验证（诚实注记：spawn 编舞的进程边界由注入面覆盖）。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { fauxProvider } from '../llm/index.js';

import {
  DAEMON_CHILD_ENV,
  clearDaemonFootprints,
  daemonPaths,
  probeDaemon,
  runDaemonServe,
  runServeStatus,
  runServeStop,
  spawnDaemonServe,
  writeDaemonPid,
  type DaemonChildHandle,
  type DaemonFs,
} from './serve-daemon.js';

/** 内存假 fs（测试自持文件宇宙——真 fs 零触） */
function memFs(initial: Record<string, string> = {}): Required<DaemonFs> & { files: Map<string, string> } {
  const files = new Map<string, string>(Object.entries(initial));
  return {
    files,
    ensureDir: () => {},
    writeFile: (path, text) => files.set(path, text),
    readFile: (path) => {
      const text = files.get(path);
      if (text === undefined) throw new Error('ENOENT');
      return text;
    },
    tryUnlink: (path) => {
      files.delete(path);
    },
  };
}

describe('三足迹与 pid 登记原语', () => {
  it('daemonPaths 词面（02 数据域表 serve/ 行）', () => {
    const p = daemonPaths('/data');
    expect(p.dir).toBe(join('/data', 'serve'));
    expect(p.pidPath).toBe(join('/data', 'serve', 'daemon.pid'));
    expect(p.sockPath).toBe(join('/data', 'serve', 'daemon.sock'));
    expect(p.logPath).toBe(join('/data', 'serve', 'daemon.log'));
  });

  it('writeDaemonPid → probeDaemon 读回；clear 幂等双清', () => {
    const fs = memFs();
    const paths = daemonPaths('/data');
    writeDaemonPid(paths, { pid: 123, startedAt: 1000 }, fs);
    expect(probeDaemon(paths, () => true, fs)).toEqual({
      running: true,
      record: { pid: 123, startedAt: 1000 },
      malformed: false,
    });
    clearDaemonFootprints(paths, fs);
    clearDaemonFootprints(paths, fs); // 幂等
    expect(fs.files.has(paths.pidPath)).toBe(false);
    expect(fs.files.has(paths.sockPath)).toBe(false);
  });

  it('probeDaemon 四态：缺席/活/死/坏登记', () => {
    const paths = daemonPaths('/data');
    expect(probeDaemon(paths, () => true, memFs())).toEqual({ running: false, malformed: false });
    const fsLive = memFs({ [paths.pidPath]: '{"pid":123,"startedAt":1}\n' });
    expect(probeDaemon(paths, () => true, fsLive).running).toBe(true);
    expect(probeDaemon(paths, () => false, fsLive)).toEqual({
      running: false,
      record: { pid: 123, startedAt: 1 },
      malformed: false,
    });
    const fsBad = memFs({ [paths.pidPath]: '{oops' });
    expect(probeDaemon(paths, () => true, fsBad).malformed).toBe(true);
    const fsBadPid = memFs({ [paths.pidPath]: '{"pid":"x"}' });
    expect(probeDaemon(paths, () => true, fsBadPid).malformed).toBe(true);
  });
});

describe('runServeStatus（只读探活——05 §6.6 豁免面）', () => {
  const paths = daemonPaths('/data');

  it('在跑：退 0 报 pid/uptime；无 token 会话数 n/a', async () => {
    const fs = memFs({ [paths.pidPath]: '{"pid":123,"startedAt":1000}\n' });
    const lines: string[] = [];
    const code = await runServeStatus({
      dataDir: '/data',
      env: {},
      now: () => 61_000, // uptime 60s
      isAlive: () => true,
      fs,
      write: (line) => lines.push(line),
    });
    expect(code).toBe(0);
    expect(lines[0]).toContain('pid 123');
    expect(lines[0]).toContain('uptime 60s');
    expect(lines[0]).toContain('n/a');
  });

  it('显式 token 形态：经 sock 面查活跃会话数', async () => {
    const fs = memFs({ [paths.pidPath]: '{"pid":123,"startedAt":0}\n' });
    const lines: string[] = [];
    const code = await runServeStatus({
      dataDir: '/data',
      env: { BERRY_AGENT_SDK_TOKEN: 'tok' },
      now: () => 0,
      isAlive: () => true,
      fs,
      write: (line) => lines.push(line),
      fetchSessionCount: async (sockPath, token) => {
        expect(sockPath).toBe(paths.sockPath);
        expect(token).toBe('tok');
        return 3;
      },
    });
    expect(code).toBe(0);
    expect(lines[0]).toContain('活跃会话 3');
  });

  it('未跑退 1；坏登记同码 1 且注记可清', async () => {
    const lines: string[] = [];
    expect(
      await runServeStatus({ dataDir: '/data', env: {}, now: () => 0, fs: memFs(), write: (l) => lines.push(l) }),
    ).toBe(1);
    expect(lines[0]).toContain('未运行');
    const fsBad = memFs({ [paths.pidPath]: 'junk' });
    expect(
      await runServeStatus({ dataDir: '/data', env: {}, now: () => 0, fs: fsBad, write: (l) => lines.push(l) }),
    ).toBe(1);
    expect(lines[1]).toContain('损坏');
  });
});

describe('runServeStop（SIGTERM → 待退出 → 清登记）', () => {
  const paths = daemonPaths('/data');

  it('未运行：清残留登记幂等退 0', async () => {
    const fs = memFs({ [paths.pidPath]: '{"pid":123,"startedAt":0}\n', [paths.sockPath]: '' });
    const lines: string[] = [];
    const code = await runServeStop({
      dataDir: '/data',
      isAlive: () => false,
      fs,
      write: (l) => lines.push(l),
      sleep: async () => {},
    });
    expect(code).toBe(0);
    expect(fs.files.has(paths.pidPath)).toBe(false); // 残留已清
    expect(fs.files.has(paths.sockPath)).toBe(false);
  });

  it('优雅路：TERM → 进程退 → 清登记退 0', async () => {
    const fs = memFs({ [paths.pidPath]: '{"pid":123,"startedAt":0}\n' });
    const signals: Array<[number, string]> = [];
    let alive = true;
    const lines: string[] = [];
    const code = await runServeStop({
      dataDir: '/data',
      isAlive: () => alive,
      fs,
      signal: (pid, sig) => {
        signals.push([pid, sig]);
        alive = false; // TERM 即退（优雅路）
      },
      sleep: async () => {},
      now: () => 0,
      write: (l) => lines.push(l),
    });
    expect(code).toBe(0);
    expect(signals).toEqual([[123, 'SIGTERM']]);
    expect(lines.at(-1)).toContain('已停');
  });

  it('升格路：TERM 不退 → 10s 窗尽 → SIGKILL → 清登记退 0', async () => {
    const fs = memFs({ [paths.pidPath]: '{"pid":123,"startedAt":0}\n' });
    const signals: string[] = [];
    let alive = true;
    let clock = 0;
    const code = await runServeStop({
      dataDir: '/data',
      isAlive: () => alive,
      fs,
      signal: (_pid, sig) => {
        signals.push(sig);
        if (sig === 'SIGKILL') alive = false; // 只认 KILL
      },
      sleep: async () => {
        clock += 200; // 步进钟：每等待步 200ms——TERM 后 50 步过 10s 窗
      },
      now: () => clock,
      write: () => {},
    });
    expect(code).toBe(0);
    expect(signals).toEqual(['SIGTERM', 'SIGKILL']);
  });
});

describe('spawnDaemonServe（spawner 编舞——注入面）', () => {
  const baseEnv = { PATH: '/usr/bin' };

  it('win32 诚实拒退 1（07 §5 不背书同裁）', async () => {
    const lines: string[] = [];
    const code = await spawnDaemonServe({
      flags: { daemon: true, noDelta: false, debug: false },
      platform: 'win32',
      env: baseEnv,
      writeErr: (l) => lines.push(l),
      sleep: async () => {},
    });
    expect(code).toBe(1);
    expect(lines[0]).toContain('win32');
  });

  it('开面判定预拦：非回环 --sdk-host 无 token 退 2 不 spawn', async () => {
    const spawns: unknown[][] = [];
    const lines: string[] = [];
    const code = await spawnDaemonServe({
      flags: { daemon: true, noDelta: false, sdkHost: '192.168.1.5', debug: false },
      dataDir: '/data',
      env: baseEnv,
      spawnFn: (...args: unknown[]) => {
        spawns.push(args);
        throw new Error('不应 spawn');
      },
      writeErr: (l) => lines.push(l),
      sleep: async () => {},
    });
    expect(code).toBe(2);
    expect(spawns).toHaveLength(0);
    expect(lines[0]).toContain('BERRY_AGENT_SDK_TOKEN');
  });

  it('正常拉起：argv 原样传旗标 + env CHILD 标记；pid 登记现即退 0', async () => {
    const fs = memFs();
    const paths = daemonPaths('/data');
    const spawns: Array<{
      cmd: string;
      args: string[];
      opts: { env: Record<string, string | undefined>; logPath: string };
    }> = [];
    let clock = 0;
    const code = await spawnDaemonServe({
      flags: { daemon: true, noDelta: true, sdkPort: 8080, debug: true },
      dataDir: '/data',
      env: baseEnv,
      self: { execPath: 'node-bin', mainPath: 'main.js' }, // 自镜像注入（不触真进程）
      spawnFn: (cmd, args, opts) => {
        spawns.push({ cmd, args: [...args], opts });
        // 假 child 即刻写 pid 登记（模拟 child 起活）
        writeDaemonPid(paths, { pid: 999, startedAt: 0 }, fs);
        return fakeChild(777);
      },
      isAlive: () => true,
      fs,
      now: () => clock,
      sleep: async () => {
        clock += 100;
      },
      writeErr: () => {},
    });
    expect(code).toBe(0);
    expect(spawns).toHaveLength(1);
    expect(spawns[0]!.cmd).toBe('node-bin');
    expect(spawns[0]!.args).toEqual(['main.js', 'serve', '--daemon', '--sdk-port', '8080', '--no-delta', '--debug']);
    expect(spawns[0]!.opts.env[DAEMON_CHILD_ENV]).toBe('1'); // 防递归标记
    expect(spawns[0]!.opts.env.PATH).toBe('/usr/bin'); // 原 env 透传
    expect(spawns[0]!.opts.logPath).toBe(paths.logPath); // stderr 重定向位
  });

  it('child 秒死：转发退出码 + daemon.log 尾行转述', async () => {
    const paths = daemonPaths('/data');
    const fs = memFs({ [paths.logPath]: '行一\n启动失败：数据目录已有活跃进程\n行三\n' });
    const lines: string[] = [];
    const code = await spawnDaemonServe({
      flags: { daemon: true, noDelta: false, debug: false },
      dataDir: '/data',
      env: baseEnv,
      spawnFn: () => fakeChild(undefined, 1), // spawn 即败形态（pid 缺席 + exitCode 1）
      isAlive: () => false,
      fs,
      now: () => 0,
      sleep: async () => {},
      writeErr: (l) => lines.push(l),
    });
    expect(code).toBe(1);
    expect(lines[0]).toContain('码 1');
    expect(lines[1]).toContain('启动失败：数据目录已有活跃进程'); // 尾行转述（≤3 行）
  });

  it('起活确认超窗：pid 登记未现退 1', async () => {
    const fs = memFs();
    const lines: string[] = [];
    let clock = 0;
    const code = await spawnDaemonServe({
      flags: { daemon: true, noDelta: false, debug: false },
      dataDir: '/data',
      env: baseEnv,
      spawnFn: () => fakeChild(777), // child 活着但从不写 pid 登记
      isAlive: () => true,
      fs,
      now: () => clock,
      sleep: async () => {
        clock += 1_000; // 步进钟速过 10s 窗
      },
      writeErr: (l) => lines.push(l),
    });
    expect(code).toBe(1);
    expect(lines[0]).toContain('超窗');
  });
});

/** 假 child 句柄（pid 在场形态/即败形态两档） */
function fakeChild(pid: number | undefined, exitCode: number | null = null): DaemonChildHandle {
  const handle: DaemonChildHandle = {
    pid,
    exitCode,
    once: (_event, listener) => {
      if (pid === undefined) listener(exitCode); // 即败形态同步退
      return handle;
    },
    unref: () => {},
  };
  return handle;
}

/* ---------------- daemon child 主体（真件集成） ---------------- */

describe('runDaemonServe（真 runtime + 真 face 全环）', () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  it('开面判定拒：非回环 sdkHost 无 token 退 2（不组装运行时）', async () => {
    const lines: string[] = [];
    const code = await runDaemonServe({
      flags: { noDelta: false, sdkHost: '192.168.1.5' },
      dataDir: '/nonexistent-but-unused', // judge 先于 runtime——不触
      env: {},
      writeErr: (l) => lines.push(l),
    });
    expect(code).toBe(2);
    expect(lines[0]).toContain('BERRY_AGENT_SDK_TOKEN');
  });

  it('全环：face 起 → pid 登记 + token 披露 → shutdown 优雅停清足迹退 0', async () => {
    const faux = fauxProvider({ provider: 'faux-daemon', models: [{ id: 'm1' }] });
    const dataDir = mkdtempSync(join(tmpdir(), 'daemon-data-'));
    dirs.push(dataDir);
    const paths = daemonPaths(dataDir);
    const lines: string[] = [];
    let runtimeShutdown: (() => Promise<void>) | undefined;

    const done = runDaemonServe({
      flags: { noDelta: false },
      dataDir,
      providers: [faux.provider],
      model: 'faux-daemon/m1',
      env: {},
      heartbeatIntervalMs: 60,
      onRuntime: (runtime) => {
        runtimeShutdown = () => runtime.shutdown();
      },
      writeErr: (l) => lines.push(l),
    });

    // 就绪等待：pid 登记现 + 就绪披露行达（10s 窗轮询）
    let ready = false;
    for (let i = 0; i < 200 && !ready; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      ready = existsSync(paths.pidPath) && lines.some((l) => l.includes('daemon 就绪'));
    }
    expect(ready, `就绪行：${lines.join(' / ')}`).toBe(true);
    expect(lines.some((l) => l.startsWith('daemon token'))).toBe(true); // 自动生成档披露
    const pidText = JSON.parse(readFileSync(paths.pidPath, 'utf8')) as { pid: number };
    expect(pidText.pid).toBe(process.pid);

    // 优雅停：runtime 六步退出序触发 closer（face.stop + 清足迹）→ 返回 0
    await runtimeShutdown!();
    await expect(done).resolves.toBe(0);
    expect(existsSync(paths.pidPath)).toBe(false); // 足迹自清
    expect(existsSync(paths.sockPath)).toBe(false); // face sockOwned 自清
  });
});
