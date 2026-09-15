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
});
