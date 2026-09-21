/**
 * host/serve-daemon 编舞测试（批 13e-3）。
 *
 * 三动词分测——status/stop 全注入（假 fs/时钟/探活/信号——编舞纯逻辑零真
 * 进程）；spawner 注入假 spawn 面（argv/env/CHILD 标记收账，不触真 fs；
 * `--port` 人面旗标透传 18a-3' 例锁）；daemon child 主体走真件集成（真
 * runtime 真库 tmpdir + 真 createSdkHttpFace + faux provider——承
 * serve-entry.test 同款组合根形态；`--port` 人面全环〔webui 路由同面 +
 * 同面单 token〕18a-3' 例锁；face 本体 22 例单测
 * 在 sdk/http.test，此处锁编舞接线：pid 登记/token 披露/优雅停清足迹）。
 *
 * 真 spawn 真进程集成不在此（vitest 无 dist/tsx 直跑运行态）——实机联调归
 * 批 13e-3 落地后手动验证（诚实注记：spawn 编舞的进程边界由注入面覆盖）。
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { canonicalWorkspaceRoot } from '../context/index.js';
import { fauxProvider } from '../llm/index.js';
import type { Store } from '../persist/index.js';

import { createCorePlugins } from './core-plugins.js';
import { createHostRuntime } from './runtime.js';
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
  type DaemonServeOptions,
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

  it('件内私有常量不进导出面（死码收口锁——六常量全仓零外部消费）', async () => {
    // 六常量（足迹词面四件 + 两时限窗）export 关键字已按「零外部消费 + API
    // 快照不在册」判据摘除——模块命名空间不应再出现这些键（防公开面回涨）。
    const mod = await import('./serve-daemon.js');
    for (const key of [
      'SERVE_DIR_BASENAME',
      'DAEMON_PID_BASENAME',
      'DAEMON_SOCK_BASENAME',
      'DAEMON_LOG_BASENAME',
      'STOP_SIGKILL_GRACE_MS',
      'SPAWN_CONFIRM_TIMEOUT_MS',
    ]) {
      expect(key in mod, `${key} 不应出现在模块导出面`).toBe(false);
    }
    // 对照组：真消费在场的面维持导出（main 分派层/测试消费族——防矫枉过正）
    expect('DAEMON_CHILD_ENV' in mod).toBe(true);
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
        // 假 child 即刻写 pid 登记（模拟 child 起活——归属比对须同形：child
        // 侧写真 process.pid，假件登记 pid 须与句柄 pid 一致）
        writeDaemonPid(paths, { pid: 999, startedAt: 0 }, fs);
        return fakeChild(999);
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

  it("`--port` 透传（18a-3'）：人面旗标 argv 先于 SDK 面族——child 侧同参组态", async () => {
    const fs = memFs();
    const paths = daemonPaths('/data');
    const spawns: Array<{ args: string[] }> = [];
    let clock = 0;
    const code = await spawnDaemonServe({
      flags: { daemon: true, port: 7860, noDelta: false, debug: false },
      dataDir: '/data',
      env: baseEnv,
      self: { execPath: 'node-bin', mainPath: 'main.js' },
      spawnFn: (_cmd, args) => {
        spawns.push({ args: [...args] });
        // 归属比对须同形：登记 pid 与句柄 pid 一致（承「正常拉起」例注）
        writeDaemonPid(paths, { pid: 999, startedAt: 0 }, fs);
        return fakeChild(999);
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
    expect(spawns[0]!.args).toEqual(['main.js', 'serve', '--daemon', '--port', '7860']);
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

  it('旧 daemon 在场掩盖路：登记非本次 child 所写——child 撞 BUSY 秒死须转发退码 + 转述 log 尾行（修前误报「已起」退 0）', async () => {
    // host-assembly#1 修前红：旧 daemon 完整在跑（serve/daemon.pid 登记在场且
    // pid 活——writeDaemonPid 在 face.start 后写）时，第二调用方 `serve --daemon`
    // spawn 的新 child 撞 active.json 单活跃机标记 HOST_DATA_DIR_BUSY 秒死——
    // 修前起活循环首轮 probe.running 命中旧 pid 即报「已起」退 0，child 退码与
    // daemon.log 尾行 BUSY 细目被静默吞（07 §1 进程模型「响亮拒绝优于静默双写」
    // + §5「第二调用方 spawn serve 撞在场 daemon = 既有 HOST_DATA_DIR_BUSY」）。
    const paths = daemonPaths('/data');
    const fs = memFs({
      [paths.pidPath]: '{"pid":123,"startedAt":1}\n', // 旧 daemon 登记（isAlive 恒 true → 活）
      [paths.logPath]: 'daemon 运行失败：数据目录已有活跃进程（pid 123，启动于 2026-09-21T00:00:00.000Z）\n',
    });
    const lines: string[] = [];
    const code = await spawnDaemonServe({
      flags: { daemon: true, noDelta: false, debug: false },
      dataDir: '/data',
      env: baseEnv,
      spawnFn: () => fakeChild(undefined, 1), // 新 child 即退 1（BUSY 秒死形）
      isAlive: () => true,
      fs,
      now: () => 0,
      sleep: async () => {},
      writeErr: (l) => lines.push(l),
    });
    expect(code).toBe(1); // 转发 child 退码（修前 0——旧登记冒认起活）
    expect(lines[0]).toContain('码 1');
    expect(lines[1]).toContain('已有活跃进程'); // BUSY 细目经 log 尾行转述达调用方
  });

  it('起活归属判据：旧 daemon 登记在场而本次 child 未登记未退——不冒认已起，超窗退 1（修前误报退 0）', async () => {
    // 归属判据另一半：登记在场且活、但非本次 child 所写、child 又没退（组装中/
    // 挂起形）——不得把旧登记冒认成本次起活（修前首轮即「已起」退 0）。
    const paths = daemonPaths('/data');
    const fs = memFs({ [paths.pidPath]: '{"pid":123,"startedAt":1}\n' });
    const lines: string[] = [];
    let clock = 0;
    const code = await spawnDaemonServe({
      flags: { daemon: true, noDelta: false, debug: false },
      dataDir: '/data',
      env: baseEnv,
      spawnFn: () => fakeChild(777), // child 活着但从不写自己的 pid 登记
      isAlive: () => true,
      fs,
      now: () => clock,
      sleep: async () => {
        clock += 1_000; // 步进钟速过 10s 窗
      },
      writeErr: (l) => lines.push(l),
    });
    expect(code).toBe(1); // 超窗（修前 0——旧登记冒认）
    expect(lines[0]).toContain('超窗');
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

/** 真占位 TCP 口（C4/E15 族——内核指派 0 口后持有不关：EADDRINUSE 确定性拒形） */
async function occupyTcpPort(): Promise<{ port: number; close(): Promise<void> }> {
  const server: Server = createServer();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr === null || typeof addr === 'string') {
        server.close();
        reject(new Error('address 非 TCP 形（占位端口基建异常）'));
        return;
      }
      resolve({ port: addr.port, close: () => new Promise<void>((r) => server.close(() => r())) });
    });
  });
}

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

  it('env 双载体回落：SDK_HOST 旗标缺席时 env 补位进三防线（07 §5 三名）', async () => {
    // env BERRY_AGENT_SDK_HOST 非回环 + 无 token → judge 拒启退 2——证明
    // env 补位经 daemonListenConfig 进 config、同走 judgeListenConfig 执法
    const lines: string[] = [];
    const code = await runDaemonServe({
      flags: { noDelta: false },
      dataDir: '/nonexistent-but-unused', // judge 先于 runtime——不触
      env: { BERRY_AGENT_SDK_HOST: '192.168.1.5' },
      writeErr: (l) => lines.push(l),
    });
    expect(code).toBe(2);
    expect(lines[0]).toContain('BERRY_AGENT_SDK_TOKEN');
  });

  it('env 双载体回落：SDK_PORT 坏值 fail-loud（lane 帽同律——字串全串判）', async () => {
    await expect(
      runDaemonServe({
        flags: { noDelta: false },
        dataDir: '/nonexistent-but-unused',
        env: { BERRY_AGENT_SDK_PORT: '8080x' },
        writeErr: () => {},
      }),
    ).rejects.toThrow(/BERRY_AGENT_SDK_PORT/);
  });

  it('env 双载体回落：SDK_PORT 域外值拒（99999——范围判对齐旗标路 positiveInt upTo:65535）', async () => {
    // 修前红锚：原 /^\d+$/ 全串判放行 99999 → 坏值推迟到运行期 listen 报错
    // （旗标路 --sdk-port 在解析期即用法错退 2——两路不对称）。SDK_HOST 借
    // 非回环无 token 造「若过闸必退 2」的确定性出口：过闸即 resolves(2)、
    // 拒启即 rejects——两态可辨，不 boot 任何运行时
    await expect(
      runDaemonServe({
        flags: { noDelta: false },
        dataDir: '/nonexistent-but-unused',
        env: { BERRY_AGENT_SDK_PORT: '99999', BERRY_AGENT_SDK_HOST: '192.168.1.5' },
        writeErr: () => {},
      }),
    ).rejects.toThrow(/BERRY_AGENT_SDK_PORT/);
  });

  it('env 双载体回落：SDK_PORT 域内值过闸（8080 到 judge 层执法——不因扩范围误伤）', async () => {
    // 8080 过 readSdkPortEnv → 真被消费进 config 走到 judgeListenConfig：
    // 非回环 × 无 token 退 2（证明域内值不被范围判误拒）
    const lines: string[] = [];
    const code = await runDaemonServe({
      flags: { noDelta: false },
      dataDir: '/nonexistent-but-unused',
      env: { BERRY_AGENT_SDK_PORT: '8080', BERRY_AGENT_SDK_HOST: '192.168.1.5' },
      writeErr: (l) => lines.push(l),
    });
    expect(code).toBe(2);
    expect(lines[0]).toContain('BERRY_AGENT_SDK_TOKEN');
  });

  it('旗标恒胜出：sdkPort 旗标在场短路 env 坏值（env 位不被消费即不炸）', async () => {
    // 胜出序负证：env 坏 port 若被读取即 RangeError；旗标在场时不读 env
    // port → 走 judge 正常路径（借 SDK_HOST 非回环无 token 造退 2 出口）
    const lines: string[] = [];
    const code = await runDaemonServe({
      flags: { noDelta: false, sdkPort: 8080 },
      dataDir: '/nonexistent-but-unused',
      env: { BERRY_AGENT_SDK_PORT: '8080x', BERRY_AGENT_SDK_HOST: '192.168.1.5' },
      writeErr: (l) => lines.push(l),
    });
    expect(code).toBe(2);
    expect(lines[0]).toContain('BERRY_AGENT_SDK_TOKEN');
  });

  it('装载面活（批 19a-3 迁 assembly 公共段）：坏形清单 fail-loud 退 1——拒在 face 起前', async () => {
    const faux = fauxProvider({ provider: 'faux-daemon2', models: [{ id: 'm1' }] });
    const dataDir = mkdtempSync(join(tmpdir(), 'daemon-data-'));
    dirs.push(dataDir);
    writeFileSync(join(dataDir, 'enabled.yaml'), 'plugins: [ Oops'); // 启用清单损坏 = 用户可自修配置错
    const lines: string[] = [];
    let faceStarted = false;
    const code = await runDaemonServe({
      flags: { noDelta: false },
      dataDir,
      providers: [faux.provider],
      model: 'faux-daemon2/m1',
      env: {},
      writeErr: (l) => lines.push(l),
      // face 工厂换哨兵：装载拒启档 face 不应被建（迁移前直调栈不读清单——本例即装载真跑回归锁）
      faceFactory: (() => {
        faceStarted = true;
        throw new Error('face 不应装配');
      }) as unknown as NonNullable<DaemonServeOptions['faceFactory']>,
    });
    expect(code).toBe(1); // 干净退出档（不写 crash.log）
    expect(faceStarted).toBe(false);
    expect(lines[0]).toContain('启动失败'); // 装配失败档归一文案
  });

  it('sdk 件缺席拒启（批 19e——07 §5 daemon 拒启律）：kit 缺席 → 退 2 + face 不建 + 运行时收口', async () => {
    const faux = fauxProvider({ provider: 'faux-daemon3', models: [{ id: 'm1' }] });
    const dataDir = mkdtempSync(join(tmpdir(), 'daemon-data-'));
    dirs.push(dataDir);
    const lines: string[] = [];
    let faceStarted = false;
    const code = await runDaemonServe({
      flags: { noDelta: false },
      dataDir,
      providers: [faux.provider],
      model: 'faux-daemon3/m1',
      env: {},
      writeErr: (l) => lines.push(l),
      // 注册表覆盖：15 件减 core:sdk（enabled.yaml 禁用形同构——kit 缺席执法面）
      corePlugins: createCorePlugins({ dataDir }).filter((ref) => ref.name !== 'sdk'),
      faceFactory: (() => {
        faceStarted = true;
        throw new Error('face 不应装配');
      }) as unknown as NonNullable<DaemonServeOptions['faceFactory']>,
    });
    expect(code).toBe(2); // 与开面判定拒启同码族（配置档干净退出）
    expect(faceStarted).toBe(false);
    expect(lines.some((l) => l.includes('core:sdk 件未装载'))).toBe(true);
  });

  it('sdkPort 端口占用：干净退 1 +「HTTP 面启动失败」呈报 + pid 不登记（失败先于 writeDaemonPid 位）', async () => {
    // C4③ 开面失败形回归锁：sdk TCP 口被占（真占位口——EADDRINUSE 确定性
    // 拒形，非 flaky）→ face.start catch 路退 1 + writeErr 一行 + 优雅收
    // runtime。主断言之一 pidPath 不在场：writeDaemonPid 在 face.start 之后
    // （:483）——失败形不得登记 pid（登记即骗 spawner「起活」）。
    // 注：sock 足迹不判（死迹自愈律——重试/EADDRINUSE 段 :952-959 自清，
    // 非本例行为锚）；done 自然 resolve 即证 runtime.shutdown 收口完成。
    const occupied = await occupyTcpPort();
    const faux = fauxProvider({ provider: 'faux-daemon-busy', models: [{ id: 'm1' }] });
    const dataDir = mkdtempSync(join(tmpdir(), 'daemon-busy-data-'));
    dirs.push(dataDir);
    const paths = daemonPaths(dataDir);
    const lines: string[] = [];
    try {
      const code = await runDaemonServe({
        flags: { noDelta: false, sdkPort: occupied.port },
        dataDir,
        providers: [faux.provider],
        model: 'faux-daemon-busy/m1',
        env: {},
        writeErr: (l) => lines.push(l),
      });
      expect(code).toBe(1); // face 启动失败档（干净退出——非 crash 形）
      expect(lines.some((l) => l.includes('HTTP 面启动失败'))).toBe(true); // 归一文案（固定串非 AI 文本）
      expect(existsSync(paths.pidPath)).toBe(false); // 失败先于登记位——不骗 spawner
    } finally {
      await occupied.close();
    }
  });

  it('双开拒：既有 daemon 占标记在场 → 退 1 + stderr 含 BUSY 细目（spawner 尾行转述的真源闭环）', async () => {
    // E15 单活跃机双开拒回归锁：真 createHostRuntime 持 active.json 标记
    // （pid 活 = 本测试进程）→ 第二次 runDaemonServe 装配段 createHostRuntime
    // 即 acquireActiveMarker 抛 HOST_DATA_DIR_BUSY → assembly 档归一呈报
    // 「启动失败：数据目录已有活跃进程（pid …）」退 1。spawner 腿的尾行
    // 转述（daemon.log 尾行即此 writeErr 面）——本例锁的就是被转述真源。
    const faux = fauxProvider({ provider: 'faux-daemon-dbl', models: [{ id: 'm1' }] });
    const dataDir = mkdtempSync(join(tmpdir(), 'daemon-dbl-data-'));
    dirs.push(dataDir);
    const first = createHostRuntime({ dataDir }); // 占标记方（启动序① acquireActiveMarker）
    const lines: string[] = [];
    try {
      const code = await runDaemonServe({
        flags: { noDelta: false },
        dataDir, // 同数据目录——双开撞标记
        providers: [faux.provider],
        model: 'faux-daemon-dbl/m1',
        env: {},
        writeErr: (l) => lines.push(l),
      });
      expect(code).toBe(1); // 启动失败档退出码（非崩溃形不写 crash.log）
      expect(lines.join('\n')).toContain('已有活跃进程'); // BUSY 细目真源（单活跃机 05 §6.6）
      expect(lines.join('\n')).toContain(String(process.pid)); // 细目含占方 pid——转述可归因
    } finally {
      await first.shutdown(); // 释放标记（否则后续同 dataDir 例被本例卡死）
    }
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

  it("`--port` 人面全环（18a-3'）：TCP 侧人面 + webui 路由同面 + 同面单 token，停后足迹清", async () => {
    const faux = fauxProvider({ provider: 'faux-daemon-port', models: [{ id: 'm1' }] });
    const dataDir = mkdtempSync(join(tmpdir(), 'daemon-port-data-'));
    dirs.push(dataDir);
    const paths = daemonPaths(dataDir);
    const lines: string[] = [];
    let runtimeShutdown: (() => Promise<void>) | undefined;

    const done = runDaemonServe({
      flags: { noDelta: false, port: 0 }, // 人面实口内核指派——披露行见实值
      dataDir,
      providers: [faux.provider],
      model: 'faux-daemon-port/m1',
      env: {},
      heartbeatIntervalMs: 60,
      onRuntime: (runtime) => {
        runtimeShutdown = () => runtime.shutdown();
      },
      writeErr: (l) => lines.push(l),
    });

    try {
      // 就绪等待：人面披露行达（webui 开面 = mount 后写）
      let webuiLine: string | undefined;
      for (let i = 0; i < 200 && webuiLine === undefined; i++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        webuiLine = lines.find((l) => l.startsWith('Web 界面已开面：http://'));
      }
      expect(webuiLine, `披露行：${lines.join(' / ')}`).toBeDefined();
      const port = Number(webuiLine!.match(/http:\/\/[^:]+:(\d+)\//)![1]);
      // token 行（自动生成档披露——同面单 token 的值源）
      const tokenLine = lines.find((l) => l.startsWith('daemon token'));
      expect(tokenLine).toBeDefined();
      const token = tokenLine!.match(/Bearer (\S+)/)![1]!;
      // 人面双族：webui 探活位（open/liveness 无凭证）+ /v1 同面单 token
      const health = await fetch(`http://127.0.0.1:${port}/api/health`);
      expect(health.status).toBe(200);
      const sessions = await fetch(`http://127.0.0.1:${port}/v1/sessions`, {
        headers: { authorization: `Bearer ${token}`, 'x-sdk-protocol': '1' },
      });
      expect(sessions.status).toBe(200);
      const anon = await fetch(`http://127.0.0.1:${port}/v1/sessions`);
      expect(anon.status).toBe(401); // 「监听 ⇒ 鉴权」
      // 披露不复述 token 值（同面单 token——见 token 行即可，人面行无值）
      expect(lines.some((l) => l.startsWith('访问令牌即 daemon token'))).toBe(true);
    } finally {
      await runtimeShutdown!();
    }
    await expect(done).resolves.toBe(0);
    expect(existsSync(paths.pidPath)).toBe(false);
    expect(existsSync(paths.sockPath)).toBe(false);
  });
});

/* ---------------- serve 四桥会话键 canonical 统一（CL-A2） ---------------- */

describe('serve 四桥会话键 canonical 统一（CL-A2）', () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  it('登记位（daemon 桥 cwd 锚）：非 canonical 锚（symlink 别名）经 canonical 化登记——查询侧按 canonical 根必命中', async () => {
    // 非 canonical 形造法：git 仓库根 + symlink 别名（canonicalWorkspaceRoot
    // (别名) = realpath 仓库根 ≠ raw 别名串——06 §74 解析律）
    const base = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'a2-daemon-')));
    const repoRoot = join(base, 'repo');
    mkdirSync(join(repoRoot, '.git'), { recursive: true });
    const alias = join(base, 'repo-link');
    symlinkSync(repoRoot, alias);
    const canonical = canonicalWorkspaceRoot(alias);
    expect(canonical).toBe(realpathSync(repoRoot)); // 前置自证：别名确非 canonical 形
    expect(canonical).not.toBe(alias);

    const faux = fauxProvider({ provider: 'faux-daemon-a2', models: [{ id: 'm1' }] });
    const dataDir = mkdtempSync(join(tmpdir(), 'daemon-a2-data-'));
    dirs.push(dataDir);
    const paths = daemonPaths(dataDir);
    const lines: string[] = [];
    let runtimeShutdown: (() => Promise<void>) | undefined;
    let store: Store | undefined; // onRuntime 捕获——查询侧真源
    const done = runDaemonServe({
      flags: { noDelta: false, port: 0 }, // 人面实口内核指派——披露行见实值
      dataDir,
      cwd: alias, // daemon 登记位：raw 别名锚注入（修前直落 raw 键）
      providers: [faux.provider],
      model: 'faux-daemon-a2/m1',
      env: {},
      heartbeatIntervalMs: 60,
      onRuntime: (runtime) => {
        store = runtime.persistence.store;
        runtimeShutdown = () => runtime.shutdown();
      },
      writeErr: (l) => lines.push(l),
    });
    try {
      // 就绪等待：人面披露行达（webui 开面 = mount 后写——承 `--port` 全环例式）
      let webuiLine: string | undefined;
      for (let i = 0; i < 200 && webuiLine === undefined; i++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        webuiLine = lines.find((l) => l.startsWith('Web 界面已开面：http://'));
      }
      expect(webuiLine, `披露行：${lines.join(' / ')}`).toBeDefined();
      const port = Number(webuiLine!.match(/http:\/\/[^:]+:(\d+)\//)![1]);
      const token = lines.find((l) => l.startsWith('daemon token'))!.match(/Bearer (\S+)/)![1]!;
      // /v1/prompt 无 sessionId → 桥 submitPrompt 走 manager.create（登记位）
      const res = await fetch(`http://127.0.0.1:${port}/v1/prompt`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-sdk-protocol': '1',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ messageId: 'a2-d-1', content: '键统一' }),
      });
      expect(res.status).toBe(200);
      const ack = (await res.json()) as { sessionId: string };
      // 行随首事件落库——等无过滤清单见本会话（红因锁定在键断言非时序）
      const t0 = Date.now();
      while (!store!.listSessions().some((row) => row.id === ack.sessionId)) {
        if (Date.now() - t0 > 4_000) throw new Error('轮询超时（会话行未落库）');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      // 断言：按 canonical 根查询必须命中（修前 raw 别名键落库 → miss → 红）
      const hit = store!.listSessions({ workspaceRoot: canonical }).find((row) => row.id === ack.sessionId);
      expect(hit, `canonical=${canonical} 键下未见会话 ${ack.sessionId}`).toBeDefined();
    } finally {
      await runtimeShutdown!();
    }
    await expect(done).resolves.toBe(0);
    expect(existsSync(paths.pidPath)).toBe(false); // 足迹自清（承全环例式）
  });
});
