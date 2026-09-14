/**
 * open 域工具装配测试 — 组装面（exec 诚实缺席/在场）+ 真三段管道执法
 * （审批对放行 / fail-closed 拒 / carve-out 硬拒 / 数据目录恒拒 / fence 分工）+
 * LIFO 拆解 + todo durable 落账。
 *
 * 纪律：mock 只停在 askApproval 呈现注入位（审批装配测试同款恒答桩）；
 * 管道 / 守门 / 审批服务 / 注册表 / fs 工具全走真实现（组合根口径——
 * 04 §7 「管道是唯一执行路径」的结构保证位即本测试的断言对象）。
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventDispatch, Scope } from '../context/index.js';
import { SessionLog } from '../session/index.js';
import type { ToolDefinition } from '../contracts/index.js';
import type { WorktreeService } from '../tools/index.js';
import { assembleOpenTools } from './open-tools.js';
import type { OpenToolsOptions } from './open-tools.js';

/* ---------------- 测试构造件 ---------------- */

type AskFace = NonNullable<OpenToolsOptions['askApproval']>;

/** 恒答呈现面（审批装配测试同款） */
const answer =
  (value: Awaited<ReturnType<AskFace>>): AskFace =>
  async () =>
    value;

function makeAssembly(overrides?: Partial<OpenToolsOptions>) {
  const workspace = mkdtempSync(join(tmpdir(), 'berry-open-ws-'));
  const dataDir = mkdtempSync(join(tmpdir(), 'berry-open-data-'));
  const session = new SessionLog({ sessionId: 's-open' });
  const dispatch = new EventDispatch();
  const scope = Scope.createRoot();
  const assembly = assembleOpenTools({
    sessionId: 's-open',
    dispatch,
    session,
    scope,
    mode: () => 'workspace-write',
    dataDir,
    workspace: () => workspace,
    ...overrides,
  });
  return { workspace, dataDir, session, dispatch, scope, assembly };
}

/** 会话事件 data 按类型取列（断言简写） */
function dataOf(session: SessionLog, type: string): unknown[] {
  return session
    .events()
    .filter((event) => event.type === type)
    .map((event) => event.data);
}

/** 按名取工具（组成断言与执行入口共用） */
function toolOf(assembly: ReturnType<typeof assembleOpenTools>, name: string) {
  const tool = assembly.tools.find((candidate) => candidate.name === name);
  if (tool === undefined) throw new Error(`工具 ${name} 不在装配面`);
  return tool;
}

/** exec 服务面假件（结构契约 ExecToolService 的最小实现——组成面专用不执行；批 19a 工厂形） */
function fakeExecService(): { createBashTool: (deps: unknown) => ToolDefinition } {
  return {
    createBashTool: () => ({
      name: 'bash',
      description: '执行 shell 命令',
      parameters: { type: 'object', properties: {} },
      effect: 'write',
      execute: async () => ({ content: [] }),
    }),
  };
}

/* ---------------- 组装面 ---------------- */

describe('assembleOpenTools 组装面', () => {
  it('exec 缺席：fs 四件 + 检索两件 + todo 一件（bash 静默缺席——对话本体仍通）', () => {
    const { assembly } = makeAssembly();
    expect(assembly.tools.map((tool) => tool.name).sort()).toEqual([
      'edit',
      'find',
      'grep',
      'ls',
      'read',
      'todo',
      'write',
    ]);
  });

  it('exec 在场：scope.provide 后装配拾取——8 件含 bash', () => {
    const scope = Scope.createRoot();
    scope.provide('exec', fakeExecService());
    const { assembly } = makeAssembly({ scope });
    expect(assembly.tools.map((tool) => tool.name)).toContain('bash');
    expect(assembly.tools).toHaveLength(8);
  });

  it('owner 缺省盖章（T9 案一批 t-1）：宿主直构件盖 core:host、extraTools 携 owner 的重放定义原样保留', () => {
    // 宿主直构件（fs/search/todo 族——open-tools 注册单点 `?? 'core:host'`）
    const { assembly } = makeAssembly();
    const owners = new Map(assembly.registry.listFor('s-open').map((def) => [def.name, def.owner]));
    expect(owners.get('read')).toBe('core:host'); // open 域 fs 族
    expect(owners.get('grep')).toBe('core:host'); // 检索族
    expect(owners.get('todo')).toBe('core:host'); // 内置 todo 件
    // extraTools 重放腿：boot 全局层定义已被受理壳铸得插件 id——缺省式不覆盖
    const { assembly: replay } = makeAssembly({
      extraTools: () => [
        {
          name: 'plugin_echo',
          description: '插件重放工具（受理壳已铸 owner 形）',
          parameters: { type: 'object' as const },
          execute: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
          owner: 'demo:plug',
        },
        {
          name: 'host_extra',
          description: '宿主 extraTools 直构件（未铸 owner 形）',
          parameters: { type: 'object' as const },
          execute: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
        },
      ],
    });
    const replayOwners = new Map(replay.registry.listFor('s-open').map((def) => [def.name, def.owner]));
    expect(replayOwners.get('plugin_echo')).toBe('demo:plug'); // 插件归因存活
    expect(replayOwners.get('host_extra')).toBe('core:host'); // 宿主件缺省盖章
  });

  it('一词两册装配序（03 §2.4）：boot 预注册工具词在先——自举注册幂等跳过不炸', () => {
    const pre = new EventDispatch();
    pre.registerEventNames(['tools_pre_execute', 'tools_execute', 'tools_post_execute', 'tools_change']); // 装载批主表镜像预注册（共享 4 词）
    const { assembly } = makeAssembly({ dispatch: pre }); // 后到面自举——跳过已注册词
    expect(assembly.tools.length).toBeGreaterThan(0); // 装配照常完成
    expect(pre.isRegistered('tools_pre_execute')).toBe(true); // 词已达（共享登记）
  });

  it('同 dispatch 多会话装配 → 幂等合法（批 19c-1 语义修正）：哨兵词跳过不炸、两会话工具面各自独立', () => {
    const dispatch = new EventDispatch();
    const first = makeAssembly({ dispatch, sessionId: 's-a' });
    // 二次装配合法形：in-process 子代理真工厂首例（同栈父子两会话各装配一次）。
    // 旧「二次装配 fail-loud」前提随多会话装配废止——同会话重复装配检测归
    // SessionManager records 幂等守卫（sessions.test 哨兵词另锁）
    const second = makeAssembly({ dispatch, sessionId: 's-b' });
    expect(first.assembly.tools.length).toBe(second.assembly.tools.length); // 两会话各自完整工具面
    expect(dispatch.isRegistered('conversation/open-tools-mounted')).toBe(true); // 哨兵词恰一册
  });
});

/* ---------------- 真三段管道执法 ---------------- */

describe('assembleOpenTools 真管道执法', () => {
  it('ls 经真三段管道：读工具放行 + gate/decision allow 落账', async () => {
    const made = makeAssembly();
    writeFileSync(join(made.workspace, 'a.txt'), 'x', 'utf8');
    const result = await toolOf(made.assembly, 'ls').execute('c-ls', { path: '.' });
    const text = result.content[0] as { type: string; text: string };
    expect(text.type).toBe('text');
    expect(text.text).toContain('a.txt');
    expect(result.isError).toBeUndefined();
    expect(dataOf(made.session, 'gate/decision')).toEqual([{ toolCallId: 'c-ls', decision: 'allow', reason: 'ok' }]);
  });

  it('write 审批 approve：真文件落盘 + 审批对成对 + gate/decision allow', async () => {
    const made = makeAssembly({ askApproval: answer('approve') });
    const result = await toolOf(made.assembly, 'write').execute('c-w1', {
      path: 'n1.txt',
      content: 'hi',
    });
    expect(result.isError).toBeUndefined();
    expect(readFileSync(join(made.workspace, 'n1.txt'), 'utf8')).toBe('hi');
    // 审批对：asked/decided 各一笔同 approvalId，decided=approve/user
    const asked = dataOf(made.session, 'approval/asked');
    const decided = dataOf(made.session, 'approval/decided');
    expect(asked).toHaveLength(1);
    expect(decided).toEqual([expect.objectContaining({ decision: 'approve', source: 'user' })]);
    expect((asked[0] as { approvalId: string }).approvalId).toBe((decided[0] as { approvalId: string }).approvalId);
    expect(dataOf(made.session, 'gate/decision')).toEqual([{ toolCallId: 'c-w1', decision: 'allow', reason: 'ok' }]);
  });

  it('askApproval 缺席 write：TOOL_BLOCKED 拒（fail-closed）+ decided unavailable + gate/decision block', async () => {
    const made = makeAssembly();
    await expect(
      toolOf(made.assembly, 'write').execute('c-w2', { path: 'n2.txt', content: 'x' }),
    ).rejects.toMatchObject({ code: 'TOOL_BLOCKED' });
    expect(dataOf(made.session, 'approval/asked')).toHaveLength(1); // 问过——无人应答
    expect(dataOf(made.session, 'approval/decided')).toEqual([expect.objectContaining({ decision: 'unavailable' })]);
    const gate = dataOf(made.session, 'gate/decision');
    expect(gate).toHaveLength(1);
    expect(gate[0]).toMatchObject({ toolCallId: 'c-w2', decision: 'block' });
    expect((gate[0] as { reason: string }).reason).toContain('unavailable');
  });

  it('carve-out 硬拒：danger 档写 .git/config——block 无审批交互（无升权出路）', async () => {
    const made = makeAssembly({ mode: () => 'danger', askApproval: answer('approve') });
    await expect(
      toolOf(made.assembly, 'write').execute('c-git', { path: '.git/config', content: 'x' }),
    ).rejects.toMatchObject({ code: 'TOOL_BLOCKED' });
    // 硬拒在审批之前：零审批对（问了也白问——不存在可批的出路）
    expect(dataOf(made.session, 'approval/asked')).toHaveLength(0);
    expect(dataOf(made.session, 'approval/decided')).toHaveLength(0);
    const gate = dataOf(made.session, 'gate/decision');
    expect(gate[0]).toMatchObject({ toolCallId: 'c-git', decision: 'block' });
    expect((gate[0] as { reason: string }).reason).toContain('carve-out');
  });

  it('数据目录恒拒：写 dataDir 内绝对路径——carve-out 条目任何档生效', async () => {
    const made = makeAssembly({ askApproval: answer('approve') });
    await expect(
      toolOf(made.assembly, 'write').execute('c-data', {
        path: join(made.dataDir, 'x.txt'),
        content: 'x',
      }),
    ).rejects.toMatchObject({ code: 'TOOL_BLOCKED' });
    expect(dataOf(made.session, 'approval/asked')).toHaveLength(0);
    expect((dataOf(made.session, 'gate/decision')[0] as { reason: string }).reason).toContain('carve-out');
  });

  it('读侧 carve-out 装配 e2e：read 点名 dataDir/secret.key → FS_READ_PROTECTED（敏感集注入回归锁——漏注入即红）', async () => {
    const made = makeAssembly();
    writeFileSync(join(made.dataDir, 'secret.key'), 'k3y-material', 'utf8');
    await expect(
      toolOf(made.assembly, 'read').execute('c-sec', { path: join(made.dataDir, 'secret.key') }),
    ).rejects.toMatchObject({ code: 'FS_READ_PROTECTED' });
    // 读脸硬拒无审批交互（04 §7——fail-closed 无审批出路）
    expect(dataOf(made.session, 'approval/asked')).toHaveLength(0);
  });

  it('读侧 carve-out 装配 e2e：grep 单文件点名 secret.key 同拒（检索脸同源注入）', async () => {
    const made = makeAssembly();
    writeFileSync(join(made.dataDir, 'secret.key'), 'k3y-material', 'utf8');
    await expect(
      toolOf(made.assembly, 'grep').execute('c-gsec', {
        pattern: 'k3y',
        path: join(made.dataDir, 'secret.key'),
      }),
    ).rejects.toMatchObject({ code: 'FS_READ_PROTECTED' });
  });

  it('邻件不殃及：dataDir 内非敏感件 read 照常（保护面精确到 basename）', async () => {
    const made = makeAssembly();
    writeFileSync(join(made.dataDir, 'notes.txt'), 'fine', 'utf8');
    const result = await toolOf(made.assembly, 'read').execute('c-note', { path: join(made.dataDir, 'notes.txt') });
    expect(result.isError).toBeUndefined();
    expect((result.content[0] as { text: string }).text).toBe('fine');
  });

  it('read-only 档 write：守门行跳过（不产审批交互），fence 执法拒', async () => {
    const made = makeAssembly({ mode: () => 'read-only', askApproval: answer('approve') });
    await expect(
      toolOf(made.assembly, 'write').execute('c-ro', { path: 'n3.txt', content: 'x' }),
    ).rejects.toMatchObject({ code: 'FS_OUTSIDE_WRITABLE_ROOTS' });
    // 执法分工的落账证据：gate 放行（read-only 不问），fence 拒（denial 回执）
    expect(dataOf(made.session, 'approval/asked')).toHaveLength(0);
    expect(dataOf(made.session, 'gate/decision')).toEqual([{ toolCallId: 'c-ro', decision: 'allow', reason: 'ok' }]);
  });

  it('todo 经真管道：全量快照 durable 落 todo/write 一笔', async () => {
    const made = makeAssembly();
    const items = [
      { status: 'in-progress', content: '接线审批三件' },
      { status: 'pending', content: '落 open 域工具装配' },
    ] as const;
    const result = await toolOf(made.assembly, 'todo').execute('c-todo', { items: [...items] });
    const text = result.content[0] as { text: string };
    expect(text.text).toContain('已更新任务清单');
    const writes = dataOf(made.session, 'todo/write');
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ items: [{ status: 'in-progress' }, { status: 'pending' }] });
    expect(dataOf(made.session, 'gate/decision')).toEqual([{ toolCallId: 'c-todo', decision: 'allow', reason: 'ok' }]);
  });
});

/* ---------------- LIFO 拆解 ---------------- */

describe('assembleOpenTools 拆解', () => {
  it('dispose 后 write 直通：守门已拆（无审批对），文件照落', async () => {
    const made = makeAssembly({ askApproval: answer('approve') });
    made.assembly.dispose();
    const result = await toolOf(made.assembly, 'write').execute('c-after', {
      path: 'n4.txt',
      content: 'after',
    });
    expect(result.isError).toBeUndefined();
    expect(readFileSync(join(made.workspace, 'n4.txt'), 'utf8')).toBe('after');
    expect(dataOf(made.session, 'approval/asked')).toHaveLength(0);
    expect(dataOf(made.session, 'approval/decided')).toHaveLength(0);
  });
});

/* ---------------- 出口消毒（出口治理③） ---------------- */

describe('assembleOpenTools 出口消毒', () => {
  it('read 工具回读含 env dump 的文件：值基腿经装配透传执法——结果进 durable 前已消毒（server 回显单源锁）', async () => {
    const secret = 'sk-e2e-live-abcdef90';
    const made = makeAssembly({ sensitiveValues: () => [secret] });
    writeFileSync(
      join(made.workspace, 'env-dump.txt'),
      `GITHUB_TOKEN=ghp_abcdef123456\nlive=${secret}\nnormal=ok\n`,
      'utf8',
    );
    const result = await toolOf(made.assembly, 'read').execute('c-read-sec', { path: 'env-dump.txt' });
    const text = result.content[0] as { type: string; text: string };
    expect(text.type).toBe('text');
    // 两腿合流：模式腿收具名形（GITHUB_TOKEN=），值基腿收裸形（live=）
    expect(text.text).toContain('GITHUB_TOKEN=[REDACTED:secret]');
    expect(text.text).toContain('live=[REDACTED:credential]');
    expect(text.text).not.toContain('ghp_abcdef123456');
    expect(text.text).not.toContain(secret);
    expect(text.text).toContain('normal=ok'); // 非敏感行零误伤
  });

  it('provider 缺席（缺省装配）：模式腿恒在场——具名形仍消毒', async () => {
    const made = makeAssembly();
    writeFileSync(join(made.workspace, 'env2.txt'), 'GITHUB_TOKEN=ghp_abcdef123456\n', 'utf8');
    const result = await toolOf(made.assembly, 'read').execute('c-read-sec2', { path: 'env2.txt' });
    const text = result.content[0] as { type: string; text: string };
    expect(text.text).toContain('GITHUB_TOKEN=[REDACTED:secret]');
    expect(text.text).not.toContain('ghp_abcdef123456');
  });
});

/* ---------------- worktree 消费接线（04 §7 补钉①——CL-A1 回归锁） ---------------- */

/**
 * worktree 服务结构假件（记账面真实现形——git 腿不跑：本测面只锁装配接线
 * 与授予/fence 消费，git 行为归 tools/worktree.test.ts 域）。create 产物
 * 路径由注入的派生器给出（测试指向 HOME 下仓外目录——缺省可写根之外，
 * fence 并入与否才可观察）；create 携 sessionId 即记账授予（与真身同律）。
 */
function fakeWorktreeService(pathFor: (name: string) => string): {
  service: WorktreeService;
  grants: Map<string, Set<string>>;
} {
  const grants = new Map<string, Set<string>>();
  const addGrant = (sessionId: string, path: string): void => {
    let set = grants.get(sessionId);
    if (set === undefined) {
      set = new Set();
      grants.set(sessionId, set);
    }
    set.add(path);
  };
  const service: WorktreeService = {
    async create(req) {
      const path = pathFor(req.name);
      // 授予记账与真身同律（04 §7 补钉①——create 成功即自动授予本会话）
      if (req.sessionId !== undefined) addGrant(req.sessionId, path);
      return { name: req.name, path, branch: req.name };
    },
    async list() {
      return [];
    },
    async clean() {
      throw new Error('不在本测面（git 腿归 tools/worktree.test.ts）');
    },
    async diffPatch() {
      throw new Error('不在本测面（git 腿归 tools/worktree.test.ts）');
    },
    async grant(req) {
      addGrant(req.sessionId, req.path);
    },
    grantedRoots(sessionId) {
      return [...(grants.get(sessionId) ?? [])];
    },
    releaseSession(sessionId) {
      const released = [...(grants.get(sessionId) ?? [])];
      grants.delete(sessionId);
      return released;
    },
  };
  return { service, grants };
}

describe('assembleOpenTools worktree 消费接线', () => {
  it('服务在场：三工具挂载（create/list/clean）；缺席：诚实缺席（会话面无 worktree 词）', () => {
    // 在场形（修前红位：worktree 选项位不存在——运行时被忽略，三名不在装配面）
    const { service } = fakeWorktreeService(() => '/nonexistent');
    const mounted = makeAssembly({ worktree: service });
    const names = mounted.assembly.tools.map((tool) => tool.name);
    expect(names).toContain('worktree_create');
    expect(names).toContain('worktree_list');
    expect(names).toContain('worktree_clean');
    // 缺席形（既有现状锁——不注入即无三词，不虚构能力）
    const bare = makeAssembly();
    for (const name of ['worktree_create', 'worktree_list', 'worktree_clean']) {
      expect(bare.assembly.tools.map((tool) => tool.name)).not.toContain(name);
    }
  });

  it('create 自动授予 → grantedRoots 活取并入 fence：授予前仓外写拒（fail-closed），授予后放行（授予起于装配后——非快照）', async () => {
    // 授予目录在 HOME 下——缺省三根（workspace + /tmp + tmpdir）之外，
    // fence 并入与否才可观察（macOS /tmp 属缺省可写根，仓外判定必须绕开）
    const grantedDir = mkdtempSync(join(homedir(), 'berry-open-wt-'));
    const { service } = fakeWorktreeService(() => grantedDir);
    // 审批计数呈现面（六役 A1 复核 blocker 锁——恒答桩升级为计数桩：授予域
    // 写必须触发审批对，防「守门判 outside 交棒、fence 却放行」的零审批旁路）
    let asks = 0;
    const countingApprove: AskFace = async (req) => {
      asks += 1;
      return answer('approve')(req);
    };
    // grantedRoots 直连服务记账面（live callback——fence 每次检查活取）
    const made = makeAssembly({
      worktree: service,
      grantedRoots: () => service.grantedRoots('s-open'),
      askApproval: countingApprove,
    });
    // 授予前：fail-closed——仓外路径拒（FS_OUTSIDE_WRITABLE_ROOTS）；拒件
    // 属 fence 拒绝面，守门行不问（ask 计数不动——拒不产生审批交互）
    let preGrantRejection: unknown;
    try {
      await toolOf(made.assembly, 'write').execute('c-pre', { path: join(grantedDir, 'out.txt'), content: 'x' });
    } catch (err) {
      preGrantRejection = err;
    }
    expect(preGrantRejection).toMatchObject({ code: 'FS_OUTSIDE_WRITABLE_ROOTS' });
    expect(asks).toBe(0);
    // create 经真三段管道：自动授予本会话（toolCtx.sessionId 记账）——
    // 断言式取工具（修前红位：三名不在装配面 → toBeDefined 断言失败）
    const worktreeCreate = made.assembly.tools.find((tool) => tool.name === 'worktree_create');
    expect(worktreeCreate).toBeDefined();
    const created = await worktreeCreate!.execute('c-wt', { name: 'issue-1' });
    expect(created.isError).toBeUndefined();
    expect(service.grantedRoots('s-open')).toContain(grantedDir);
    // create 是 write-effect 工具（非 fs 族——整名审批）：恰问一次（守门行
    // 对 write/exec 意图零免检，授予动作本身也过审批对）
    expect(asks).toBe(1);
    // 授予后：同路径写放行（修前红位：grantedRoots 零消费 → 仍拒）——且必过
    // 审批对（六役 A1 blocker 锁：守门行与 fence 同根集后授予域写按「在根内」
    // 判定走审批，非误判 outside 交棒放行——根集并入只扩「批了能成」的域）
    asks = 0;
    let postGrantRejection: unknown;
    try {
      const written = await toolOf(made.assembly, 'write').execute('c-post', {
        path: join(grantedDir, 'out.txt'),
        content: 'in-wt',
      });
      expect(written.isError).toBeUndefined();
    } catch (err) {
      postGrantRejection = err;
    }
    expect(postGrantRejection).toBeUndefined();
    // blocker 锁本体：授予域写零审批放行 = 红（A1 复核实抓 askCount=0 缺陷
    // ——同根集修复后守门行按「在根内」走审批对，ask ≥ 1 才是放行正道）
    expect(asks).toBeGreaterThanOrEqual(1);
    expect(readFileSync(join(grantedDir, 'out.txt'), 'utf8')).toBe('in-wt');
    rmSync(grantedDir, { recursive: true, force: true });
  });
});
