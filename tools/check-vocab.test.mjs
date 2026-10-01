import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 词汇门禁 spawn 自测（07 篇 §7.4 续件 4 + #10——「不进门禁的守护炮静默
 * 过期」教训：扫描逻辑静默退化先在测试面红）。
 *
 * 两形红绿证（与门禁同一进程形态，不绕闸）：
 * - 净树：真仓跑 exit 0；
 * - 已知违规夹具：临时根造 src/ + README、经 CHECK_VOCAB_ROOT env 根缝注入
 *   子进程——每腿独立夹具根防互染，exit 1 + stderr 点名违规。
 * - 豁免对照腿：外部真值（.app 路径串 / CDP 协议名 / AppState 前端惯例词）
 *   与豁免形（-pi perl 旗标 / 谱系闸机制自产词）单独成夹具必须绿——
 *   豁免逻辑自身有锁，防静默失效变误报闸。
 */
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHECK_SCRIPT = join(REPO_ROOT, 'tools/check-vocab.mjs');
/** 夹具总根（各腿独立子目录；收口统一清） */
const FIXTURE_ROOT = mkdtempSync(join(tmpdir(), 'check-vocab-test-'));

afterAll(() => rmSync(FIXTURE_ROOT, { recursive: true, force: true }));

/**
 * 子进程跑检查器。
 * @param {string} [fixture] 夹具根（给定时注入 CHECK_VOCAB_ROOT 缝；缺省真仓）
 * @returns {{ status: number, out: string }} 退出码 + 合并输出
 */
function runCheck(fixture) {
  const r = spawnSync(process.execPath, [CHECK_SCRIPT], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...(fixture ? { CHECK_VOCAB_ROOT: fixture } : {}) },
    encoding: 'utf8',
  });
  return { status: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/**
 * 造夹具根：files 形如 { 'src/webui/index.ts': "const app = 1;" }。
 * @param {string} name 夹具名（独立子目录）
 * @param {Record<string, string>} files 相对路径 → 文件内容
 * @returns {string} 夹具根绝对路径
 */
function fixture(name, files) {
  const root = join(FIXTURE_ROOT, name);
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

describe('check-vocab 守护炮自测（spawn 全闸形态）', () => {
  it('净树恒绿（真仓 exit 0 + 计数行）', () => {
    const { status, out } = runCheck();
    expect(status).toBe(0);
    expect(out).toContain('check-vocab 绿');
  });

  it('app 标识符位 → 红（const app 独立词）', () => {
    const root = fixture('app-ident', {
      'src/webui/index.ts': 'export const app = 1;\n',
    });
    const { status, out } = runCheck(root);
    expect(status).toBe(1);
    expect(out).toContain('「app」');
  });

  it('enablePlugin 复合形 → 红（生命周期语境弃用词）', () => {
    const root = fixture('lifecycle', {
      'src/plugins/api.ts': 'export function enablePlugin(id: string) { return id; }\n',
    });
    const { status, out } = runCheck(root);
    expect(status).toBe(1);
    expect(out).toContain('enablePlugin');
  });

  it('中文违形复合 → 红（应用中心）', () => {
    const root = fixture('zh-violation', {
      'src/webui/index.ts': '// 应用中心入口\nexport const x = 1;\n',
    });
    const { status, out } = runCheck(root);
    expect(status).toBe(1);
    expect(out).toContain('应用中心');
  });

  it('谱系词公开文档面 → 红（对标叙事）', () => {
    const root = fixture('lineage', {
      'README.md': '# demo\n\n对标某知名项目。\n',
    });
    const { status, out } = runCheck(root);
    expect(status).toBe(1);
    expect(out).toContain('对标');
  });

  it('.app 路径字符串豁免 → 夹具绿（macOS Chrome 真值）', () => {
    const root = fixture('app-path', {
      'src/browser/discover.ts': "export const p = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';\n",
    });
    const { status } = runCheck(root);
    expect(status).toBe(0);
  });

  it('CDP 协议名字符串豁免 → 夹具绿（Page.enable）', () => {
    const root = fixture('cdp-protocol', {
      'src/browser/page.ts':
        "export async function f(send: (m: string) => Promise<void>) { await send('Page.enable'); }\n",
    });
    const { status } = runCheck(root);
    expect(status).toBe(0);
  });

  it('AppState 前端惯例词豁免 → 夹具绿（React 生态应用状态）', () => {
    const root = fixture('app-state', {
      'src/webui/client/frames.ts': 'export interface AppState { n: number; }\n',
    });
    const { status } = runCheck(root);
    expect(status).toBe(0);
  });

  it('perl -pi 旗标豁免 → 夹具绿（排查指引真值）', () => {
    const root = fixture('perl-pi', {
      'docs/development.md': '# 开发\n\n排查用 `perl -pi -e` 替换。\n',
    });
    const { status } = runCheck(root);
    expect(status).toBe(0);
  });

  it('谱系闸机制自产词豁免 → 夹具绿（Job 归属执法词）', () => {
    const root = fixture('lineage-gate', {
      'docs/plugin-development.md': '# 插件\n\n登记恒携归属（谱系闸执法）。\n',
    });
    const { status } = runCheck(root);
    expect(status).toBe(0);
  });

  // —— 查四文档腿红绿锁（2026-10-01 补翻批扩射程——修前红形：旧炮对用户面
  //    文档的禁替词全量漏报，扩射程后夹具即红）———

  it('查四文档腿：usage.md 用户面禁替词 → 红（缺省）', () => {
    const root = fixture('doc-userface-red', {
      'docs/usage.md': '# 使用指南\n\n端口缺省 7860。\n',
    });
    const { status, out } = runCheck(root);
    expect(status).toBe(1);
    expect(out).toContain('「缺省」');
  });

  it('查四文档腿：工程域文档不在射程 → 夹具绿（development.md 应答）', () => {
    const root = fixture('doc-userface-scope', {
      'docs/development.md': '# 开发\n\nSDK 应答帧说明（工程域文档）。\n',
    });
    const { status } = runCheck(root);
    expect(status).toBe(0);
  });

  it('查四文档腿：链接锚段豁免 → 夹具绿（锚随目标标题走）', () => {
    const root = fixture('doc-userface-anchor', {
      'docs/usage.md': '# 使用指南\n\n见 [面板说明](./x.md#tui-副屏)。\n',
    });
    const { status } = runCheck(root);
    expect(status).toBe(0);
  });

  // —— 查四产码腿扩面锁（2026-10-01 wf_db273e73 扫描处置——修前红形：旧炮
  //    只收根 src/，SDK 错误消息串整面漏报；复合形补词同批）———

  it('查四产码腿：packages/*/src 禁替词串 → 红（SDK 消费者可见面入射程）', () => {
    const root = fixture('sdk-userface-red', {
      'packages/berry-agent-sdk/src/http.ts': "export const msg = '帧应答异常';\n",
    });
    const { status, out } = runCheck(root);
    expect(status).toBe(1);
    expect(out).toContain('「应答」');
  });

  it('查四产码腿：复合形补词「装配面」 → 红（低歧义复合形滚动补词表）', () => {
    const root = fixture('userface-compound', {
      'src/host/wiring.ts': "export const msg = '装配面缺席——无法启动';\n",
    });
    const { status, out } = runCheck(root);
    expect(status).toBe(1);
    expect(out).toContain('「装配面」');
  });

  it('查四产码腿：裸词入表「在飞/活体/词法违例」 → 红（纯黑话无对照态直咬——wf_70e9b7b8 裸词入表谱）', () => {
    const root = fixture('userface-bare', {
      'src/host/wiring.ts':
        "export const a = '在飞请求达上限';\nexport const b = '活体哈希不符';\nexport const c = '键词法违例';\n",
    });
    const { status, out } = runCheck(root);
    expect(status).toBe(1);
    expect(out).toContain('「在飞」');
    expect(out).toContain('「活体」');
    expect(out).toContain('「词法违例」');
  });

  it('查四产码腿：新模块 codes.ts 注册表 → 绿（19→23 文件豁免台账随批补——出生晚于枚举不入红）', () => {
    const root = fixture('userface-registry-exempt', {
      'src/issue/codes.ts': "export const CODES = { X: { description: '同键在飞互斥撞锁' } };\n",
    });
    const { status, out } = runCheck(root);
    expect(status).toBe(0);
    expect(out).toContain('check-vocab 绿');
  });
});
