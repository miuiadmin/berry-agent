/**
 * host/plugin-grants-fence 组合根测试——grants 调用级执法（04 §7 编舞条款·
 * ①段二，2026-10-16 硬伤处置第三批第二波腿 2；裁决档 = 2026-10-17 用户
 * AskUserQuestion 四问推荐档全落——〔2026-10-17 定谳注（boot 授予交集冻结档）〕）。
 *
 * 执法形（04 §7 编舞条款）：ctx.tools.register 受理壳执行体（executeWithWindow
 * 同位）再包 grants fence——执法闭包装载时冻结 boot 授予交集值（与装载账
 * roots 同值、两用非同一物——不引用账行对象，冻结副本闭包常驻）；执法判据 =
 * 冻结交集 ∩ 调用时 live fence 根（safety createRootsProvider 单源——会话
 * 档位 sandbox/mode fold）为空且 def.effect ∈ {write, exec}（缺省 exec 亦入
 * 执法集——fail-closed，04 §9 未知缺省最危律）→ 执行体拒跑、isError 错误
 * 回执复用在册码 FS_OUTSIDE_WRITABLE_ROOTS（零新码）。
 *
 * 覆盖面（任务清单逐项）：
 *  - 声明 grants 的第三方插件 write 工具：冻结交集空 → 拒跑
 *    isError+FS_OUTSIDE_WRITABLE_ROOTS；read 效果同件放行（执法集只 write/exec）；
 *  - exec 效果同律：显式 exec 与缺省 effect（归一 exec——未知缺省最危律）均拒；
 *  - 冻结交集含 live fence 根 → 放行：装机态 workspace 锚命中 / --plugin-file
 *    开发态插件目录锚命中（03 §4.2 双锚——试件行锚插件目录）；
 *  - read-only 档恒拒两形：boot 解析档恒空 / live 会话档空（frozen 非空亦拒）
 *    ——sessionMode 收 ToolContext.sessionId（per-session fold 路由锁）；
 *  - danger 档全盘 live 根放行（档位是裁决面——双向）；
 *  - 未声明 grants 的第三方插件 = 冻结交集空写面全关（fail-closed——
 *    03 §4.1「不申请 = 无该面」；fence 对磁盘行恒接线）；
 *  - core: 件豁免（03 §4.6 先例——官方件高危面经宿主装配裁决直开不被门检拦；
 *    core 合成清单无 grants 块）；
 *  - core:host 装配工具零变（registry 直注册不经受理壳——fence 结构性不可达）；
 *  - boot 后盘上配置漂移不生效（冻结义）；换代装载重冻结（/reload 重算——
 *    bootPlugins 同管线重跑同构锁其装载腿）；
 *  - 两用非同一物：账行 roots 数组外力改写不波及执法冻结副本。
 *
 * 组合根全栈惯例：真盘真 jiti 装载（plain JS entry——layDiskPlugin 形）+
 * HostRuntime 结构化替身 + grantsFence 真接线。平台鲁棒性：期望值经
 * canonicalPath 求交（macOS /var → /private/var 符号链接两侧同律），无裸串
 * 假设；「fence 根外」布局用 homedir 族临时目录（tmpdir 本身是 workspace-write
 * 档 fence 根——不可当根外用）。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { EventDispatch, Scope } from '../context/index.js';
import { canonicalPath } from '../safety/index.js';
import type { AgentToolResult, ToolDefinition } from '../contracts/index.js';

import type { CorePluginReference } from './loader.js';
import { bootPlugins, QUICK_TEST_ROW_ID } from './plugin-boot.js';
import type { PluginBootOptions } from './plugin-boot.js';
import type { HostRuntime } from './runtime.js';

/** 临时目录族（数据目录 × 工作区 × fence 根外开发态目录统一清） */
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** HostRuntime 结构化替身（装载序消费面 = dataDir/memory/registerCloser） */
function stubRuntime(dataDir: string | null): HostRuntime {
  return {
    memory: dataDir === null,
    dataDir,
    persistence: {} as HostRuntime['persistence'], // 装载序不消费——占位
    abortSignal: new AbortController().signal,
    disclosure: () => null,
    registerCloser: () => undefined,
    registerShutdownHook: () => undefined,
    registerDisposer: () => undefined,
    shutdown: async () => undefined,
    writeCrashLog: () => undefined,
  };
}

/**
 * 工具注册 entry 源（plain JS——jiti 转译装载）：四效果面工具各一（write /
 * exec / 缺省归一 exec / read），execute 体回执 RAN:<name> 标记（放行断言
 * 判据——执行体真跑过的确定性证据，非 AI 生成文本）。
 */
const ENTRY_SRC = [
  'export const inject = [];',
  'export default async (ctx) => {',
  '  const mk = (name) => async () => ({ content: [{ type: "text", text: "RAN:" + name }] });',
  '  ctx.tools.register({ name: "gw_write", description: "写效果工具（grants 执法集）", parameters: { type: "object", properties: {} }, effect: "write", execute: mk("gw_write") });',
  '  ctx.tools.register({ name: "gw_exec", description: "执行效果工具（grants 执法集）", parameters: { type: "object", properties: {} }, effect: "exec", execute: mk("gw_exec") });',
  '  ctx.tools.register({ name: "gw_default", description: "缺省效果工具（归一 exec）", parameters: { type: "object", properties: {} }, execute: mk("gw_default") });',
  '  ctx.tools.register({ name: "gw_read", description: "读效果工具（执法集外）", parameters: { type: "object", properties: {} }, effect: "read", execute: mk("gw_read") });',
  '};',
].join('\n');

/** 结果文本面（isError 断言的判据源——content 文本块拼接） */
const textOf = (res: AgentToolResult): string => res.content.map((c) => (c.type === 'text' ? c.text : '')).join('');

/**
 * 拒跑断言：isError + 在册码 FS_OUTSIDE_WRITABLE_ROOTS + 归因两片段（插件
 * id / 工具名——deterministic 错误回执面的 toContain 代理断言）。
 */
async function expectFenced(
  def: ToolDefinition | undefined,
  pluginId: string,
  toolCtx: { toolCallId: string; sessionId?: string } = { toolCallId: 'fence-1' },
): Promise<void> {
  expect(def, '工具须已注册（fence 拒执行不拒注册——调用级执法）').toBeDefined();
  const res = await def!.execute({}, toolCtx);
  expect(res.isError).toBe(true);
  const text = textOf(res);
  expect(text).toContain('[FS_OUTSIDE_WRITABLE_ROOTS]');
  expect(text).toContain(pluginId);
  expect(text).toContain(def!.name);
}

/** 放行断言：执行体真跑（RAN 标记）且非 isError */
async function expectRan(
  def: ToolDefinition | undefined,
  toolCtx: { toolCallId: string; sessionId?: string } = { toolCallId: 'run-1' },
): Promise<void> {
  expect(def).toBeDefined();
  const res = await def!.execute({}, toolCtx);
  expect(res.isError).toBeFalsy();
  expect(textOf(res)).toContain(`RAN:${def!.name}`);
}

/**
 * 装机态磁盘行铺设（真盘真 jiti——读侧三源 enabled.yaml/ledger/package.json
 * 全真；多行累加）。grants 缺参 = 未声明面（fail-closed 用例用）。
 * @returns 插件目录（manifest 改写用例复用）
 */
function layDiskPlugin(dataDir: string, id: string, writableRoots?: readonly string[]): string {
  const pluginDir = join(dataDir, 'plugins', 'node_modules', id);
  mkdirSync(pluginDir, { recursive: true });
  const berryAgent: Record<string, unknown> = { entry: 'entry.js' };
  if (writableRoots !== undefined) berryAgent['grants'] = { writableRoots: [...writableRoots] };
  writeFileSync(join(pluginDir, 'package.json'), JSON.stringify({ name: id, version: '1.0.0', berryAgent }));
  writeFileSync(join(pluginDir, 'entry.js'), ENTRY_SRC);
  const enabledPath = join(dataDir, 'enabled.yaml');
  const prevEnabled = existsSync(enabledPath) ? readFileSync(enabledPath, 'utf8') : 'plugins:\n';
  writeFileSync(enabledPath, `${prevEnabled}  - id: ${id}\n`);
  const ledgerPath = join(dataDir, 'plugins', 'ledger.json');
  const ledger: Record<string, unknown> = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, 'utf8')) : {};
  ledger[id] = { installPath: `plugins/node_modules/${id}` };
  writeFileSync(ledgerPath, JSON.stringify(ledger));
  return pluginDir;
}

/** 开发态试件目录铺设（--plugin-file 目录形——package.json + entry.js） */
function layDevPlugin(pluginDir: string, writableRoots?: readonly string[]): void {
  mkdirSync(pluginDir, { recursive: true });
  const berryAgent: Record<string, unknown> = { entry: 'entry.js' };
  if (writableRoots !== undefined) berryAgent['grants'] = { writableRoots: [...writableRoots] };
  writeFileSync(join(pluginDir, 'package.json'), JSON.stringify({ name: 'dev-fence', version: '1.0.0', berryAgent }));
  writeFileSync(join(pluginDir, 'entry.js'), ENTRY_SRC);
}

/** 装配选项速记——grantsFence 恒带（fence 执法接线形；各用例按需覆写） */
function rig(overrides: Partial<PluginBootOptions> = {}): PluginBootOptions {
  return {
    runtime: overrides.runtime ?? stubRuntime(null),
    scope: Scope.createRoot(),
    dispatch: new EventDispatch(),
    commands: { register: () => () => undefined },
    llm: { registerProvider: () => () => undefined },
    version: '9.9.9-test',
    warn: () => undefined,
    grantsFence: { workspace: '/data/wk', mode: 'workspace-write' },
    ...overrides,
  };
}

describe('grants 调用级执法（04 §7 编舞条款·①段二——〔2026-10-17 定谳注（boot 授予交集冻结档）〕）', () => {
  it('声明 grants 的第三方 write 工具：冻结交集空 → 拒跑 isError + FS_OUTSIDE_WRITABLE_ROOTS（read 效果同件放行）', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'fence-decl-data-'));
    const ws = mkdtempSync(join(tmpdir(), 'fence-decl-ws-'));
    dirs.push(dataDir, ws);
    // 开发态试件常驻 fence 根外（homedir 族——tmpdir 是 workspace-write 档
    // fence 根不可当根外用；03 §4.2「布局事实非缺陷」）：声明了 grants
    // ['./assets'] 但锚定根（插件目录）不在任何 fence 根内 → 冻结交集空
    const devDir = mkdtempSync(join(homedir(), 'berry-agent-fence-decl-'));
    dirs.push(devDir);
    layDevPlugin(devDir, ['./assets']);
    const boot = await bootPlugins(
      rig({
        runtime: stubRuntime(dataDir),
        pluginFile: devDir,
        grantsFence: { workspace: ws, mode: 'workspace-write' },
      }),
    );
    expect(boot.report.failed).toEqual([]);
    const find = (name: string) => boot.tools.definitions().find((t) => t.name === name);
    await expectFenced(find('gw_write'), QUICK_TEST_ROW_ID);
    // 拒跑非拒注册：fence 后工具仍在册、再呼仍拒（调用级执法非装载级拦）
    expect(find('gw_write')).toBeDefined();
    await expectFenced(find('gw_write'), QUICK_TEST_ROW_ID);
    // read 效果不在执法集：同插件同靴照跑（读写分面）
    await expectRan(find('gw_read'));
  });

  it('exec 效果同律：显式 exec 与缺省 effect（归一 exec——04 §9 未知缺省最危律）均拒', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'fence-exec-data-'));
    const ws = mkdtempSync(join(tmpdir(), 'fence-exec-ws-'));
    dirs.push(dataDir, ws);
    const devDir = mkdtempSync(join(homedir(), 'berry-agent-fence-exec-'));
    dirs.push(devDir);
    layDevPlugin(devDir, ['./assets']);
    const boot = await bootPlugins(
      rig({
        runtime: stubRuntime(dataDir),
        pluginFile: devDir,
        grantsFence: { workspace: ws, mode: 'workspace-write' },
      }),
    );
    expect(boot.report.failed).toEqual([]);
    const find = (name: string) => boot.tools.definitions().find((t) => t.name === name);
    await expectFenced(find('gw_exec'), QUICK_TEST_ROW_ID);
    await expectFenced(find('gw_default'), QUICK_TEST_ROW_ID); // 缺省 effect 归一 exec 亦入执法集
  });

  it('装机态 workspace 锚命中：冻结交集含 live fence 根 → write 工具放行（账面 roots 同值对账）', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'fence-disk-data-'));
    const ws = mkdtempSync(join(tmpdir(), 'fence-disk-ws-'));
    dirs.push(dataDir, ws);
    layDiskPlugin(dataDir, 'fence-disk', ['./assets']);
    const boot = await bootPlugins(
      rig({ runtime: stubRuntime(dataDir), grantsFence: { workspace: ws, mode: 'workspace-write' } }),
    );
    expect(boot.report.failed).toEqual([]);
    const write = boot.tools.definitions().find((t) => t.name === 'gw_write');
    await expectRan(write);
    // 两用同值对账：账面 roots（审计归因面）= workspace 锚定 canonical 值
    expect(boot.grantsOf('fence-disk')?.roots).toEqual([canonicalPath(join(ws, 'assets'))]);
  });

  it('--plugin-file 开发态插件目录锚命中（03 §4.2 双锚）：试件目录在工作区内 → 冻结交集非空 → 放行', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'fence-dev-data-'));
    const ws = mkdtempSync(join(tmpdir(), 'fence-dev-ws-'));
    dirs.push(dataDir, ws);
    const devDir = join(ws, 'devplug');
    layDevPlugin(devDir, ['./assets']);
    const boot = await bootPlugins(
      rig({
        runtime: stubRuntime(dataDir),
        pluginFile: devDir,
        grantsFence: { workspace: ws, mode: 'workspace-write' },
      }),
    );
    expect(boot.report.failed).toEqual([]);
    const write = boot.tools.definitions().find((t) => t.name === 'gw_write');
    await expectRan(write);
    // plugin-dir 锚：交集 = canonical(devplug/assets)（试件行账面在程视图含）
    expect(boot.grantsOf(QUICK_TEST_ROW_ID)?.roots).toEqual([canonicalPath(join(devDir, 'assets'))]);
  });

  it('live 会话档位 fold（createRootsProvider 单源）：read-only 档 live 根空恒拒（frozen 非空亦拒）/ danger 档放行 / sessionMode 收 ToolContext.sessionId', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'fence-live-data-'));
    const ws = mkdtempSync(join(tmpdir(), 'fence-live-ws-'));
    dirs.push(dataDir, ws);
    layDiskPlugin(dataDir, 'fence-live', ['./assets']); // frozen = [ws/assets] 非空
    const seen: Array<string | undefined> = [];
    const boot = await bootPlugins(
      rig({
        runtime: stubRuntime(dataDir),
        grantsFence: {
          workspace: ws,
          mode: 'workspace-write',
          // per-session fold 取值器（装配根注入位——read-only 收窄/danger 放宽
          // 两向都在档位是裁决面语义内）
          sessionMode: (sessionId) => {
            seen.push(sessionId);
            return sessionId === 's-ro' ? 'read-only' : sessionId === 's-danger' ? 'danger' : 'workspace-write';
          },
        },
      }),
    );
    expect(boot.report.failed).toEqual([]);
    const write = boot.tools.definitions().find((t) => t.name === 'gw_write');
    // 无 sessionId（缺省腿）→ boot 档 fold 放行
    await expectRan(write);
    // read-only 会话：live fence 根空 → 执法交集恒空 → 恒拒（frozen 非空亦拒）
    await expectFenced(write, 'fence-live', { toolCallId: 'f-ro', sessionId: 's-ro' });
    expect(seen).toContain('s-ro'); // ToolContext.sessionId 路由锁（per-session fold 消费键）
    // danger 会话：live 根 [sep] 全盘 ⊇ frozen → 放行
    await expectRan(write, { toolCallId: 'r-danger', sessionId: 's-danger' });
  });

  it('grantedRoots live 并入（04 §7 补钉①——装配根接线批）：workspace-write 档 live 根含本会话授予根（per-session 分发）/ 他会话不串 / read-only 档恒不并入（授予不越档）', async () => {
    // 观测面设计：声明 writableRoots: [] 的行 frozen 恒空 → workspace-write
    // 档下亦恒拒 → 拒跑回执的「调用时 live fence 根」列表面即授予根并与否
    // 的确定性观测位（宿主铸形回执文本，非 AI 生成面）
    const dataDir = mkdtempSync(join(tmpdir(), 'fence-grant-data-'));
    const ws = mkdtempSync(join(tmpdir(), 'fence-grant-ws-'));
    dirs.push(dataDir, ws);
    layDiskPlugin(dataDir, 'fence-grant', []); // frozen = [] 恒空 → 恒拒 + 回执见 live 根列表面
    const grantsBySession = new Map<string, string[]>([['s-g', ['/nonexistent-grant-root/wt-g']]]);
    const boot = await bootPlugins(
      rig({
        runtime: stubRuntime(dataDir),
        grantsFence: {
          workspace: ws,
          mode: 'workspace-write',
          // read-only 会话键 = s-ro（越档授予无效腿）；其余 workspace-write
          sessionMode: (sessionId) => (sessionId === 's-ro' ? 'read-only' : 'workspace-write'),
          // 授予根 live 取值器（fence 输入第四槽——装配根注入位）
          grantedRoots: (sessionId) => grantsBySession.get(sessionId ?? '') ?? [],
        },
      }),
    );
    expect(boot.report.failed).toEqual([]);
    const write = boot.tools.definitions().find((t) => t.name === 'gw_write');
    expect(write).toBeDefined();
    // 本会话授予根并入：s-g 的 live 根列表面含授予根（修前红位：槽缺席被
    // 忽略 → live 根恒三根 → toContain 红）
    const resOwn = await write!.execute({}, { toolCallId: 'g-own', sessionId: 's-g' });
    expect(resOwn.isError).toBe(true); // frozen 空 → 恒拒（观测前提）
    expect(textOf(resOwn)).toContain('[FS_OUTSIDE_WRITABLE_ROOTS]');
    expect(textOf(resOwn)).toContain(canonicalPath('/nonexistent-grant-root/wt-g'));
    // 他会话不串：s-other 无授予 → 列表面不含 s-g 的授予根
    const resOther = await write!.execute({}, { toolCallId: 'g-other', sessionId: 's-other' });
    expect(resOther.isError).toBe(true);
    expect(textOf(resOther)).not.toContain('/nonexistent-grant-root/wt-g');
    // 越档授予无效：read-only 会话 live 根恒空（回执「（空）」字面）——授予
    // 根不因在场面翻身（档位是裁决面）
    const resRo = await write!.execute({}, { toolCallId: 'g-ro', sessionId: 's-ro' });
    expect(resRo.isError).toBe(true);
    expect(textOf(resRo)).toContain('live fence 根 （空）');
    expect(textOf(resRo)).not.toContain('/nonexistent-grant-root/wt-g');
  });

  it('boot 解析档 read-only：冻结交集恒空 → write 工具恒拒（声明 grants 亦空——deriveWritableRoots(read-only)=[]）；read 照放', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'fence-ro-data-'));
    const ws = mkdtempSync(join(tmpdir(), 'fence-ro-ws-'));
    dirs.push(dataDir, ws);
    layDiskPlugin(dataDir, 'fence-ro', ['./assets']);
    const boot = await bootPlugins(
      rig({ runtime: stubRuntime(dataDir), grantsFence: { workspace: ws, mode: 'read-only' } }),
    );
    expect(boot.report.failed).toEqual([]);
    const find = (name: string) => boot.tools.definitions().find((t) => t.name === name);
    await expectFenced(find('gw_write'), 'fence-ro');
    expect(boot.grantsOf('fence-ro')?.roots).toEqual([]); // 账面同律（boot 档空）
    await expectRan(find('gw_read'));
  });

  it('未声明 grants 的第三方插件：冻结交集空 = 写面全关（fail-closed——03 §4.1「不申请 = 无该面」；fence 对磁盘行恒接线）', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'fence-bare-data-'));
    const ws = mkdtempSync(join(tmpdir(), 'fence-bare-ws-'));
    dirs.push(dataDir, ws);
    layDiskPlugin(dataDir, 'fence-bare'); // 无 grants 声明
    const boot = await bootPlugins(
      rig({ runtime: stubRuntime(dataDir), grantsFence: { workspace: ws, mode: 'workspace-write' } }),
    );
    expect(boot.report.failed).toEqual([]);
    const write = boot.tools.definitions().find((t) => t.name === 'gw_write');
    await expectFenced(write, 'fence-bare');
    expect(boot.grantsOf('fence-bare')?.roots).toEqual([]);
  });

  it('core: 件豁免（03 §4.6 先例）：core 行 apply 注册 write 工具不经 grants fence（core 合成清单无 grants 块）', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'fence-core-data-'));
    const ws = mkdtempSync(join(tmpdir(), 'fence-core-ws-'));
    dirs.push(dataDir, ws);
    const ref: CorePluginReference = {
      name: 'fencetest',
      apply: async (ctx) => {
        (ctx as { tools: { register: (d: unknown) => unknown } }).tools.register({
          name: 'cw_write',
          description: 'core 件写效果工具（豁免面）',
          parameters: { type: 'object', properties: {} },
          effect: 'write',
          execute: async () => ({ content: [{ type: 'text', text: 'RAN:cw_write' }] }),
        });
      },
    };
    const boot = await bootPlugins(
      rig({
        runtime: stubRuntime(dataDir),
        corePlugins: [ref],
        grantsFence: { workspace: ws, mode: 'workspace-write' },
      }),
    );
    expect(boot.report.activated.map((a) => a.id)).toEqual(['core:fencetest']);
    const tool = boot.tools.definitions().find((t) => t.name === 'cw_write');
    await expectRan(tool); // 豁免：core 行不注入 fence——官方件高危面经宿主装配裁决直开
    expect(boot.grantsOf('core:fencetest')).toBeUndefined(); // 账面同律（段一：core 行无申请面）
  });

  it('core:host 装配工具零变：registry 直注册不经受理壳（open-tools 同形）——fence 结构性不可达', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'fence-host-data-'));
    const ws = mkdtempSync(join(tmpdir(), 'fence-host-ws-'));
    dirs.push(dataDir, ws);
    // fence 生效的 boot（frozen 非空也不影响——本断言对象是宿主直构件）
    layDiskPlugin(dataDir, 'fence-host', ['./assets']);
    const boot = await bootPlugins(
      rig({ runtime: stubRuntime(dataDir), grantsFence: { workspace: ws, mode: 'workspace-write' } }),
    );
    expect(boot.report.failed).toEqual([]);
    // 宿主装配直注册（core:host owner——open-tools 装配位同形，不走
    // ctx.tools.register 受理壳 → 无插件身份无 fence 包装）
    boot.tools.register({
      name: 'host_direct_tool',
      description: '宿主装配直注册工具（owner core:host）',
      parameters: { type: 'object', properties: {} },
      effect: 'write',
      owner: 'core:host',
      execute: async () => ({ content: [{ type: 'text', text: 'RAN:host_direct_tool' }] }),
    });
    const tool = boot.tools.definitions().find((t) => t.name === 'host_direct_tool');
    await expectRan(tool);
  });

  it('boot 后盘上配置漂移不生效（冻结义）；换代装载重冻结（/reload 重算——bootPlugins 同管线重跑同构锁其装载腿）', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'fence-drift-data-'));
    const ws = mkdtempSync(join(tmpdir(), 'fence-drift-ws-'));
    dirs.push(dataDir, ws);
    const pluginDir = layDiskPlugin(dataDir, 'fence-drift', ['./assets']);
    const boot1 = await bootPlugins(
      rig({ runtime: stubRuntime(dataDir), grantsFence: { workspace: ws, mode: 'workspace-write' } }),
    );
    const w1 = boot1.tools.definitions().find((t) => t.name === 'gw_write');
    await expectRan(w1); // frozen = [ws/assets] 非空
    // 盘上漂移：manifest grants 收空（boot 后改写——启用行/grants 漂移同律）
    writeFileSync(
      join(pluginDir, 'package.json'),
      JSON.stringify({
        name: 'fence-drift',
        version: '1.0.0',
        berryAgent: { entry: 'entry.js', grants: { writableRoots: [] } },
      }),
    );
    // 在程闭包不受盘上漂移影响（冻结义——boot 授予交集值 boot 一次定死）
    await expectRan(w1);
    // 换代重冻结：同装载管线重跑按新盘态重算（/reload reapply = runBoot(false)
    // 重走本管线——装配编舞腿不在本测试射程，装载腿以重跑同构锁）
    const boot2 = await bootPlugins(
      rig({ runtime: stubRuntime(dataDir), grantsFence: { workspace: ws, mode: 'workspace-write' } }),
    );
    const w2 = boot2.tools.definitions().find((t) => t.name === 'gw_write');
    await expectFenced(w2, 'fence-drift');
    expect(boot2.grantsOf('fence-drift')?.roots).toEqual([]);
  });

  it('两用非同一物（定谳注）：账行 roots 数组外力改写不波及执法冻结副本（冻结副本闭包常驻）', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'fence-copy-data-'));
    const ws = mkdtempSync(join(tmpdir(), 'fence-copy-ws-'));
    dirs.push(dataDir, ws);
    const devDir = mkdtempSync(join(homedir(), 'berry-agent-fence-copy-'));
    dirs.push(devDir);
    layDevPlugin(devDir, ['./assets']); // frozen = []（fence 根外锚）
    const boot = await bootPlugins(
      rig({
        runtime: stubRuntime(dataDir),
        pluginFile: devDir,
        grantsFence: { workspace: ws, mode: 'workspace-write' },
      }),
    );
    const write = boot.tools.definitions().find((t) => t.name === 'gw_write');
    await expectFenced(write, QUICK_TEST_ROW_ID);
    // 外力把 live 命中根塞进账行数组（readonly 脱壳——模拟账行对象被改写）：
    // 若执法闭包直接引用账行数组（两用同一物违定谳注），此改写会让拒跑翻
    // 放行——期望仍拒即冻结副本独立的结构性锁
    const account = boot.grantsOf(QUICK_TEST_ROW_ID);
    expect(account).toBeDefined();
    (account!.roots as string[]).push(canonicalPath(ws));
    await expectFenced(write, QUICK_TEST_ROW_ID);
  });
});
