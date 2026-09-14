/**
 * runIssueVerify 真子进程回归锚（core-plugins.ts 模块私有 runIssueVerify——IssueVerifyFace 真身，
 * 函数名唯一可 grep——不锚行号防漂移）。
 *
 * 现状背景：issue 编排层对 verify 面的消费（service.test.ts）全用 mock 假件——
 * 真身（host spawn 家族：/bin/sh -c 语义 + SIGKILL 超时击杀 + 尾滚动收集内存帽
 * + 多字节边界截尾 + spawn 失败折 exitCode null + resolve 幂等）此前零测试锚。
 * 本文件补真子进程例（c-4 批「spawn 真子进程往返」先例同族——bash.test.ts 直跑
 * 系统 /bin/sh；CI 双 OS darwin+linux，echo/pwd/sleep/printf/head/tr 均在场）。
 *
 * 捕获缝说明：runIssueVerify 是 core-plugins 模块私有函数（makeIssuePlugin 装配
 * 时以 `verify: { runVerify: runIssueVerify }` 注入 createIssueService——零导出
 * 面）。本文件经 issue barrel 的 passthrough vi.mock **只包一层记录**（不替身
 * 任何行为——createIssueService 仍调真身），从装配位捕获生产真闭包后直测其
 * 子进程语义；起件走手施 core:issue（主闸四前件全配，前件服务最小桩——件内
 * 网络面（github backend）/git 面（worktree）在本测试零触达）。
 */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createCorePlugins } from './core-plugins.js';
import { ISSUE_VERIFY_TAIL_BYTES } from '../issue/types.js';
import type { IssueVerifyFace } from '../issue/types.js';

/* ---------------- 捕获缝：issue barrel passthrough（仅记录 verify 注入面） ---------------- */

/** 装配期捕获位（vi.hoisted——vi.mock 工厂提升到文件顶，捕获体必须同步可用） */
const verifyCapture = vi.hoisted(() => ({ face: undefined as IssueVerifyFace | undefined }));

// passthrough 单点包裹：spread 全真导出 + createIssueService 记录 deps.verify 后
// 原样转发——零行为替身，捕获到的是 core-plugins 模块内铸造的生产闭包本体
vi.mock('../issue/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../issue/index.js')>();
  return {
    ...actual,
    createIssueService: (deps: Parameters<typeof actual.createIssueService>[0]) => {
      verifyCapture.face = deps.verify;
      return actual.createIssueService(deps);
    },
  };
});

/* ---------------- 起件（手施 core:issue——捕获真 verify 闭包一次） ---------------- */

/** 临时目录族（统一清） */
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 真身闭包（beforeAll 起件捕获——全 describe 共享单次装配） */
let runVerify: IssueVerifyFace['runVerify'];

beforeAll(async () => {
  // 主闸四前件全配：config（apply 第二参）+ token + session seam（deps）+
  // scheduler/jobs（ctx tryGet 桩）+ state/budget（deps 桩）——dataDir null 走
  // 无危险闸形（channels.registerCommand 零触达）
  const plugins = createCorePlugins({
    dataDir: null,
    issueGithubToken: 'gh-verify-anchor',
    issueSession: {
      // 起会桩——本测试不驱动编排层（runOne 零触达），只过主闸三
      startHeadless: async () => ({
        sessionId: 's-verify-anchor',
        outcome: Promise.resolve({ status: 'completed', messagesUsed: 0, summary: '' }),
      }),
    },
    issueState: {
      getStoreState: () => undefined,
      setStoreState: () => undefined,
      deleteStoreState: () => false,
    },
    issueBudget: { canAffordIssue: () => ({ ok: true }) },
  });
  const issueRef = plugins.find((p) => p.name === 'issue');
  if (issueRef === undefined) throw new Error('core:issue 件缺席——前提漂移，fail-loud 停手');

  // 前件服务最小桩：jobs（start() 的 registerKind）+ scheduler（轮询行登记位）
  const jobsFace = {
    registerKind: () => undefined,
    register: () => ({ settle: () => false }),
    running: () => [],
  };
  const schedulerFace = { service: { addBuiltinJob: () => undefined, removeJob: () => undefined } };
  const ctx = {
    // goal/exec/checkpoint 探测缺席 = capabilities 空（合法形——enqueue 才消费）
    tryGet: (name: string): unknown => (name === 'jobs' ? jobsFace : name === 'scheduler' ? schedulerFace : undefined),
    provide: () => undefined,
  };
  const dispose = await issueRef.apply(ctx, { repos: ['owner/repo'] });
  if (verifyCapture.face === undefined) {
    throw new Error('verify 注入面未被捕获——主闸未过或装配前提漂移，fail-loud 停手');
  }
  runVerify = verifyCapture.face.runVerify;
  await dispose?.(); // service.stop()——scheduler 桩收尾（真 verify 闭包仍持引用可调）
});

/** 新临时工作目录速记（verify 的 cwd 试件） */
function workDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'berry-verify-anchor-'));
  dirs.push(dir);
  return dir;
}

describe('runIssueVerify 真子进程语义（host spawn 家族真身）', () => {
  it('① sh -c 语义：命令串经 /bin/sh -c 解释执行（echo 真值回显进输出尾）', async () => {
    const r = await runVerify({ cwd: workDir(), command: 'echo berry-verify-anchor-echo', timeoutMs: 10_000 });
    // 退出码 0 + 非超时 + 回显真值出现在合并输出尾（shell 解释层真跑的直接证据）
    expect(r.exitCode).toBe(0);
    expect(r.timedOut).toBe(false);
    expect(r.outputTail).toContain('berry-verify-anchor-echo');
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('①b cwd 锚定：子进程工作目录落在 req.cwd（pwd 真值对拍——macOS /var 符号链按 realpath 归一）', async () => {
    const dir = workDir();
    const r = await runVerify({ cwd: dir, command: 'pwd', timeoutMs: 10_000 });
    expect(r.exitCode).toBe(0);
    expect(r.outputTail.trim()).toBe(realpathSync(dir)); // /bin/sh pwd = 物理 getcwd
  });

  it('② SIGKILL 超时击杀：短 timeoutMs + sleep 长命令 → timedOut 旗 + exitCode null（信号杀）+ 时长贴时帽', async () => {
    const r = await runVerify({ cwd: workDir(), command: 'sleep 30', timeoutMs: 250 });
    // SIGKILL 后 close 的 code = null（信号杀非自然退出）；timedOut 旗由击杀前置位
    expect(r.timedOut).toBe(true);
    expect(r.exitCode).toBeNull();
    // 时长判据：≥ 时帽（容差——挂钟取整抖动）且远小于 sleep 全程（真击杀非等完）
    expect(r.durationMs).toBeGreaterThanOrEqual(200);
    expect(r.durationMs).toBeLessThan(10_000);
  }, 15_000);

  it('②b 进程组击杀：孙进程持管道写端形（后台 sleep + 前台长 sleep）→ 时帽到全组灭、击杀即收口不等孙进程自然退出', async () => {
    // 修前病锚：单 pid SIGKILL 只断 sh 树根，孙进程（后台 sleep 2 / 前台 sleep 8）
    // 继承 stdout 管道写端 → 'close' 悬到最长孙进程自然退出（~8000ms）才触发
    // ——verify promise 挂死、Job 永占并行帽一席。'sleep 30' 单命令锚不到此病
    // （sh 对末尾单命令 exec 优化无孙进程），须后台 & 双 sleep 形。
    // 修后形：detached 进程组 + 负 pid 全组击杀 + 击杀即直收口——durationMs
    // 贴时帽（400ms 级）远小于孙进程全程 8000ms；击杀即收口的 timer 腿注记
    // 首行在场（产品固定报文——锁「直收口」腿胜出，非侥幸快 close）。
    const r = await runVerify({ cwd: workDir(), command: 'sleep 2 & sleep 8', timeoutMs: 400 });
    expect(r.timedOut).toBe(true);
    expect(r.exitCode).toBeNull(); // 信号杀非自然退出
    expect(r.outputTail).toContain('超时击杀'); // timer 腿直收口注记（extraTail 首行）
    // 时长判据：≥ 时帽（容差）且远小于最长孙进程全程 8s——修前 ~8000ms 才收口（此即红锚）
    expect(r.durationMs).toBeGreaterThanOrEqual(350);
    expect(r.durationMs).toBeLessThan(2500);
  }, 15_000);

  it('③ 退出非零：exit 7 直达退出码 + stdout/stderr 合并进输出尾（两流都可见）', async () => {
    const r = await runVerify({
      cwd: workDir(),
      command: 'echo out-anchor-line; echo err-anchor-line >&2; exit 7',
      timeoutMs: 10_000,
    });
    expect(r.exitCode).toBe(7); // sh -c 的 exit 码透传
    expect(r.timedOut).toBe(false);
    expect(r.outputTail).toContain('out-anchor-line'); // stdout
    expect(r.outputTail).toContain('err-anchor-line'); // stderr 合并收集
  });

  it('④ spawn 失败折 exitCode null：cwd 不存在 → error/close 双事件下 resolve 幂等先到先得（不炸不悬）', async () => {
    // 不存在的 cwd：spawn 异步 error（ENOENT）——error 后 close 可能再触发，
    // finish 双达靠 resolve 幂等收口（先到先得：error 腿的 exitCode null +
    // 执行体异常注记胜出；promise 恒 settle 不上抛——非 0 判据归编排层）
    const r = await runVerify({
      cwd: join(workDir(), 'no-such-subdir'),
      command: 'echo never-runs',
      timeoutMs: 10_000,
    });
    expect(r.exitCode).toBeNull();
    expect(r.timedOut).toBe(false);
    expect(r.outputTail).toContain('执行体异常'); // error 腿注记（extraTail 首行）
  });

  it('⑤ 多字节边界截尾：输出超帽恰落在多字节字符中间 → 起点前移过续字节（无 U+FFFD 乱码）', async () => {
    // 1500 个「喵」= 4500 字节 > 4096 帽 → 保尾截断起点 404 落在第 135 个字符
    // 的续字节上 → 边界前移到 405（3 字节整）→ 尾 = 1365 个完整「喵」
    const r = await runVerify({
      cwd: workDir(),
      command: 'i=0; while [ $i -lt 1500 ]; do printf 喵; i=$((i+1)); done',
      timeoutMs: 10_000,
    });
    expect(r.exitCode).toBe(0);
    // 精确锁：4500 - 405 = 4095 字节 = 1365 个完整三字节字符（若边界前移律
    // 失效则首字符是断裂续字节串，decode 产 U+FFFD 前缀——串不等即红）
    expect(r.outputTail).toBe('喵'.repeat(1365));
  }, 15_000);

  it('⑥ 尾滚动收集内存帽：100KiB 输出远超 4 倍滚动窗（16KiB）→ 弃头保尾仍精确（终尾 = 4096 字节）', async () => {
    // head -c 100000 /dev/zero | tr：双 OS 在场的快速大输出形（/dev/zero 零读盘）
    const r = await runVerify({
      cwd: workDir(),
      command: 'head -c 100000 /dev/zero | tr "\\0" x',
      timeoutMs: 10_000,
    });
    expect(r.exitCode).toBe(0);
    // 滚动窗 16KiB 多轮折叠后终尾截 ISSUE_VERIFY_TAIL_BYTES（4096）——精确等值
    // 锁「弃头不丢尾」：少一字节（滚动丢尾）或多一字节（帽失效）皆红
    expect(r.outputTail).toBe('x'.repeat(ISSUE_VERIFY_TAIL_BYTES));
  });
});
