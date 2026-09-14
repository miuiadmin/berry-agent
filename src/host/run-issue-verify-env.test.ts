/**
 * runIssueVerify env 窄白名单回归锁（03 §10.7 第四役补笔附段 a——验证门
 * 三附段之 a；真身锚 = core-plugins.ts 模块私有 runIssueVerify）。
 *
 * 修前病：spawn 选项无 env 键 = 全继承 process.env——宿主凭证回落链值
 * （assembly.ts BERRY_AGENT_GITHUB_TOKEN 等）泄进验证子进程，其输出尾再直嵌
 * 公开回执 = 凭证经回执外泄的现成通道（附段 b 输出消毒归路 A，本文件只锁
 * env 面）。
 *
 * 修形（规范钉两条）：白名单窄面 + 缺省不含宿主凭证位——与 c-4 凭证注入腿
 * buildChildEnv 机制族同源（注入腿是白名单展开进子进程、验证面是只给白名单
 * 最小集），复用 exec 缺省 allow 单源 DEFAULT_ENV_ALLOW（PATH/HOME/TZ 类
 * 基座——成员随 04 §11 装配批同源演进，本锁按单源对拍不硬编清单）。
 *
 * 捕获缝与姊妹件 run-issue-verify.test.ts 同形：issue barrel passthrough
 * vi.mock 只包一层记录（零行为替身），从装配位捕获生产真闭包后直测其
 * 子进程 env 语义。独立成文件：验证门时帽/击杀语义锁在姊妹件（他批占用），
 * env 面单锁于此互不干扰。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createCorePlugins } from './core-plugins.js';
import { DEFAULT_ENV_ALLOW } from '../exec/index.js';
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
  // 哨兵还原（防跨测试泄漏——process.env 是进程级共享面）
  for (const name of Object.keys(sentinels)) {
    if (sentinels[name] === undefined) delete process.env[name];
    else process.env[name] = sentinels[name];
  }
});

/** 宿主哨兵原值账（beforeAll 快照——afterAll 原样还原） */
const sentinels: Record<string, string | undefined> = {};

/** 真身闭包（beforeAll 起件捕获） */
let runVerify: IssueVerifyFace['runVerify'];

beforeAll(async () => {
  // 主闸四前件最小桩（姊妹件同形——dataDir null 走无危险闸形，verify 闭包
  // 在装配位铸造即被捕获，件内网络/git 面零触达）
  const plugins = createCorePlugins({
    dataDir: null,
    issueGithubToken: 'gh-verify-env',
    issueSession: {
      startHeadless: async () => ({
        sessionId: 's-verify-env',
        outcome: Promise.resolve({ status: 'completed', messagesUsed: 0, summary: '' }),
      }),
    },
    issueState: { getStoreState: () => undefined, setStoreState: () => undefined, deleteStoreState: () => false },
    issueBudget: { canAffordIssue: () => ({ ok: true }) },
  });
  const issueRef = plugins.find((p) => p.name === 'issue');
  if (issueRef === undefined) throw new Error('core:issue 件缺席——前提漂移，fail-loud 停手');
  const jobsFace = { registerKind: () => undefined, register: () => ({ settle: () => false }), running: () => [] };
  const schedulerFace = { service: { addBuiltinJob: () => undefined, removeJob: () => undefined } };
  const ctx = {
    tryGet: (name: string): unknown => (name === 'jobs' ? jobsFace : name === 'scheduler' ? schedulerFace : undefined),
    provide: () => undefined,
  };
  const dispose = await issueRef.apply(ctx, { repos: ['owner/repo'] });
  if (verifyCapture.face === undefined) {
    throw new Error('verify 注入面未被捕获——主闸未过或装配前提漂移，fail-loud 停手');
  }
  runVerify = verifyCapture.face.runVerify;
  await dispose?.();

  // 宿主侧布哨：凭证回落链位 + 普通 BERRY_AGENT_* 位各一枚——宿主在场形
  //（修前全继承即泄进子进程；修后白名单两键均不在列）
  for (const name of ['BERRY_AGENT_GITHUB_TOKEN', 'BERRY_AGENT_VERIFY_ENV_SENTINEL']) {
    sentinels[name] = process.env[name];
  }
  process.env.BERRY_AGENT_GITHUB_TOKEN = 'ghp_env_leak_sentinel';
  process.env.BERRY_AGENT_VERIFY_ENV_SENTINEL = 'plain-sentinel';
});

/** 新临时工作目录速记（verify 的 cwd 试件） */
function workDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'berry-verify-env-'));
  dirs.push(dir);
  return dir;
}

describe('runIssueVerify env 窄白名单（03 §10.7 第四役附段 a——修前红：全继承 process.env）', () => {
  it('① 宿主凭证位不泄进验证子进程：BERRY_AGENT_GITHUB_TOKEN 与 BERRY_AGENT_* 哨兵在宿主在场而子进程缺席', async () => {
    // shell 参数展开 ${VAR+x}（POSIX——不依赖外部二进制）：VAR 已设（含空值）
    // 输出 PRESENT、未设输出 ABSENT。修前全继承 → 两枚 PRESENT（红锚）；
    // 修后白名单不含任何 BERRY_AGENT_* → 两枚 ABSENT
    const r = await runVerify({
      cwd: workDir(),
      command:
        'if [ -n "${BERRY_AGENT_GITHUB_TOKEN+x}" ]; then echo TOKEN_PRESENT; else echo TOKEN_ABSENT; fi; ' +
        'if [ -n "${BERRY_AGENT_VERIFY_ENV_SENTINEL+x}" ]; then echo SENTINEL_PRESENT; else echo SENTINEL_ABSENT; fi',
      timeoutMs: 10_000,
    });
    expect(r.exitCode).toBe(0);
    expect(r.outputTail).toContain('TOKEN_ABSENT'); // 凭证回落链位缺省不入子进程（规范第二条）
    expect(r.outputTail).toContain('SENTINEL_ABSENT'); // BERRY_AGENT_* 位整族不入（白名单窄面）
    expect(r.outputTail).not.toContain('ghp_env_leak_sentinel'); // 值位双保险——明文零外显
  });

  it('② 子进程 env 键集 ⊆ 白名单单源（DEFAULT_ENV_ALLOW 对拍）且 PATH 在场（npm test 量级命令可跑的基座）', async () => {
    // 名字面 dump（env|cut|sort|tr 双 OS 在场）：修前含哨兵与 vitest worker 自设
    // 键（VITEST_* 等）→ 键集 ⊆ 白名单不成立（红锚）；修后仅白名单拷贝
    const r = await runVerify({
      cwd: workDir(),
      command: 'env | cut -d= -f1 | sort | tr "\\n" ","',
      timeoutMs: 10_000,
    });
    expect(r.exitCode).toBe(0);
    const names = r.outputTail
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name !== '');
    // shell 自设三件（非宿主继承——/bin/sh 启动自设，spawn env 传什么都不
    // 影响）：PWD（cwd 锚定）、SHLVL（嵌套深度）、_（exec 链上一命令位）
    const shellIntrinsics = new Set(['PWD', 'SHLVL', '_']);
    const allow = new Set(DEFAULT_ENV_ALLOW); // 白名单单源对拍（不硬编清单）
    const extras = names.filter((name) => !allow.has(name) && !shellIntrinsics.has(name));
    expect(extras).toEqual([]); // 继承键集 ⊆ 白名单（修前红锚：宿主全量泄漏 60+ 名）
    expect(names).toContain('PATH'); // 基座在场（printenv/npm 查找可行性）
  });
});
