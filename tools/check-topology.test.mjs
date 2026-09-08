import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 模块 DAG 拓扑门禁 spawn 自测（07 篇 §7.4 #10——「不进门禁的守护炮静默
 * 过期」教训：扫描逻辑静默退化先在测试面红）。
 *
 * 两形红绿证（与门禁同一进程形态，不绕闸）：
 * - 净树：真仓跑 exit 0；
 * - 已知违规夹具：临时根造 src/ 结构、经 CHECK_TOPOLOGY_ROOT env 根缝注入
 *   子进程——每腿独立夹具根防互染，exit 1 + stderr 点名违规。
 */
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHECK_SCRIPT = join(REPO_ROOT, 'tools/check-topology.mjs');
/** 夹具总根（各腿独立子目录；收口统一清） */
const FIXTURE_ROOT = mkdtempSync(join(tmpdir(), 'check-topology-test-'));

afterAll(() => rmSync(FIXTURE_ROOT, { recursive: true, force: true }));

/**
 * 子进程跑检查器。
 * @param {string} [fixture] 夹具根（给定时注入 CHECK_TOPOLOGY_ROOT 缝；缺省真仓）
 * @returns {{ status: number, out: string }} 退出码 + 合并输出
 */
function runCheck(fixture) {
  const r = spawnSync(process.execPath, [CHECK_SCRIPT], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...(fixture ? { CHECK_TOPOLOGY_ROOT: fixture } : {}) },
    encoding: 'utf8',
  });
  return { status: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/**
 * 造夹具根：files 形如 { 'src/webui/index.ts': "import …" }。
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

describe('check-topology 守护炮自测（spawn 全闸形态）', () => {
  it('净树恒绿（真仓 exit 0 + 计数行）', () => {
    const { status, out } = runCheck();
    expect(status).toBe(0);
    expect(out).toContain('lint:topology 绿');
  });

  it('跨模块未声明边 → 红（webui→session 不在边表）', () => {
    const root = fixture('edge-violation', {
      'src/webui/index.ts': "import { x } from '../session/index.js';\nexport const y = x;\n",
    });
    const { status, out } = runCheck(root);
    expect(status).toBe(1);
    expect(out).toContain('未在边表');
    expect(out).toContain('session');
  });

  it('裸导入越账 → 红（better-sqlite3 只准 persist——webui 账无此项）', () => {
    const root = fixture('external-violation', {
      'src/webui/index.ts': "import Database from 'better-sqlite3';\nexport const db = Database;\n",
    });
    const { status, out } = runCheck(root);
    expect(status).toBe(1);
    expect(out).toContain("裸导入 'better-sqlite3'");
  });

  it('深挖实现面 → 红（session→context 在边表，但 logger.ts 非公开面三名）', () => {
    const root = fixture('deep-face-violation', {
      'src/session/index.ts': "import { logger } from '../context/logger.js';\nexport const log = logger;\n",
    });
    const { status, out } = runCheck(root);
    expect(status).toBe(1);
    expect(out).toContain('深挖 context 实现面（logger.ts）');
  });

  it('src 顶层散文件 → 红（不属于任何在场模块）', () => {
    const root = fixture('loose-file', {
      'src/loose.ts': "import { x } from './contracts/index.js';\nexport const y = x;\n",
    });
    const { status, out } = runCheck(root);
    expect(status).toBe(1);
    expect(out).toContain('不属于任何在场模块');
  });

  it('相对导入跳出 src → 红', () => {
    const root = fixture('escape-src', {
      'src/session/index.ts': "import { x } from '../../outside.js';\nexport const y = x;\n",
    });
    const { status, out } = runCheck(root);
    expect(status).toBe(1);
    expect(out).toContain('跳出 src');
  });

  it('边表内公开面合法 → 夹具绿（对照腿：三名命中不误伤）', () => {
    const root = fixture('legal-import', {
      'src/session/index.ts': "import { x } from '../contracts/index.js';\nexport const y = x;\n",
    });
    const { status, out } = runCheck(root);
    expect(status).toBe(0);
    expect(out).toContain('lint:topology 绿');
  });
});
