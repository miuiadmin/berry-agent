import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
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
    // W5 任务②计数锚：绿行必须带「扫描文件 N / import 语句 M」
    expect(out).toMatch(/扫描文件 \d+ \/ import 语句 \d+/);
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

  // ---- W5 批（2026-09-15）两腿：任务① SDK 产码入扫描面 / 任务② 扫描面自检锚 ----

  it('SDK 深挖主仓实现面 → 红（packages 产码深挖 persist/state.ts 未在面册）', () => {
    const root = fixture('sdk-deep-violation', {
      'src/contracts/index.ts': 'export const x = 1;\n',
      'packages/berry-agent-sdk/src/client.ts':
        "import { y } from '../../../src/persist/state.js';\nexport const z = y;\n",
    });
    const { status, out } = runCheck(root);
    expect(status).toBe(1);
    expect(out).toContain('SDK 深挖 persist 实现面（state.ts）');
  });

  it('SDK 裸导入越账 → 红（better-sqlite3 不在 SDK 包白名单——裸包分账同样覆盖 packages 产码）', () => {
    const root = fixture('sdk-external-violation', {
      'src/contracts/index.ts': 'export const x = 1;\n',
      'packages/berry-agent-sdk/src/client.ts': "import Database from 'better-sqlite3';\nexport const db = Database;\n",
    });
    const { status, out } = runCheck(root);
    expect(status).toBe(1);
    expect(out).toContain("SDK 裸导入 'better-sqlite3'");
  });

  it('SDK 包内相对导入 + 主仓公开面三名 → 绿（对照腿：包内豁免与公开面命中不误伤）', () => {
    const root = fixture('sdk-legal', {
      'src/contracts/index.ts': 'export const x = 1;\n',
      'packages/berry-agent-sdk/src/types.ts': 'export const a = 1;\n',
      'packages/berry-agent-sdk/src/client.ts':
        "import { a } from './types.js';\nimport { b } from '../../../src/contracts/index.js';\nimport { spawn } from 'node:child_process';\nexport const c = a ?? b ?? spawn;\n",
    });
    const { status, out } = runCheck(root);
    expect(status).toBe(0);
    expect(out).toContain('lint:topology 绿');
  });

  it('扫描面漏检 → 红（未接线扫描根的 packages 包：glob 真源有、扫描集无）', () => {
    const root = fixture('unwired-package', {
      'src/contracts/index.ts': 'export const x = 1;\n',
      'packages/other-pkg/src/a.ts': 'export const y = 1;\n',
    });
    const { status, out } = runCheck(root);
    expect(status).toBe(1);
    expect(out).toContain('扫描面漏检');
    expect(out).toContain('packages/other-pkg/src/a.ts');
  });

  // ---- 字面量键唯一自检（2026-09-15 spec-align 批防再犯锁）----
  // 缘起 = MODULE_EXTERNALS 重复 host 键：后键覆盖前键、c924c16 注册笔整条
  // 遮蔽为静默死码而四门禁全绿。自检读「自身真身」（import.meta），故以变异
  // 拷贝法造红：真脚本复制进夹具、向 MODULE_EXTERNALS 字面量头部注入重复
  // host 键——被检对象即变异拷贝本体；CHECK_TOPOLOGY_ROOT 给可扫描最小
  // src 树（扫描腿不崩即可，红来自键账对拍）。

  // ---- I-infra 批（2026-09-21）：动态 import 字面量形入裸导入账 ----
  // 缘起：importSpecifiers 原只识别静态两形，`await import('better-sqlite3')`
  // 整类假绿——头注维度 2「better-sqlite3 只准 persist」对动态形式失效；本批
  // 第三支动态形（裸说明符入账）+ host 补册 typebox/compile（loader.ts 缺省
  // 虚拟面装载位——登记批漏此子路径而门禁因不扫动态形从未拦下）。

  it('动态裸导入越账 → 红（await import 单行形——静态两形扫描零命中的整类缝）', () => {
    const root = fixture('dynamic-external-violation', {
      'src/webui/index.ts': "export const db = await import('better-sqlite3');\n",
    });
    const { status, out } = runCheck(root);
    expect(status).toBe(1);
    expect(out).toContain("裸导入 'better-sqlite3'");
  });

  it('动态裸导入合法 → 绿（host 账 typebox 三子路径含补册的 typebox/compile——对照腿不误伤）', () => {
    const root = fixture('dynamic-external-legal', {
      'src/host/index.ts':
        "export const faces = await Promise.all([import('typebox'), import('typebox/value'), import('typebox/compile')]);\n",
    });
    const { status, out } = runCheck(root);
    expect(status).toBe(0);
    expect(out).toContain('lint:topology 绿');
  });

  it('SDK 动态裸导入越账 → 红（SDK 扫描段同享动态形——packages 产码动态 better-sqlite3 同拦）', () => {
    const root = fixture('sdk-dynamic-external-violation', {
      'src/contracts/index.ts': 'export const x = 1;\n',
      'packages/berry-agent-sdk/src/client.ts': "export const db = await import('better-sqlite3');\n",
    });
    const { status, out } = runCheck(root);
    expect(status).toBe(1);
    expect(out).toContain("SDK 裸导入 'better-sqlite3'");
  });

  it('行注释内动态形不误伤 → 绿（注释体剥除——真树 import-gate.ts 头注/行尾注释两形的前提）', () => {
    const root = fixture('dynamic-comment-guard', {
      'src/host/index.ts':
        "// 伪码示例：const db = await import('better-sqlite3');\nexport const ok = await import('typebox');\n",
    });
    const { status, out } = runCheck(root);
    expect(status).toBe(0);
    expect(out).toContain('lint:topology 绿');
  });

  it('相对动态形不入账 → 绿（值位/类型位两形均本批执法面外——维度 2 裁量锁）', () => {
    const root = fixture('dynamic-relative-scope', {
      'src/contracts/index.ts': 'export const x = 1;\n',
      'src/contracts/llm.ts': 'export type StopReason = string;\n',
      // 值位形 + 类型位形：类型位 `import('../contracts/llm.js')` 静态等价形会
      // 红（深挖面）——相对动态形不入账（在场类型位深挖用法先在，边表/面册
      // 维度的动态执法随规范先行批另立，本批只封裸导入分账整类缝）
      'src/agent/index.ts':
        "export const c = import('../contracts/index.js');\nexport type S = import('../contracts/llm.js').StopReason;\n",
    });
    const { status, out } = runCheck(root);
    expect(status).toBe(0);
    expect(out).toContain('lint:topology 绿');
  });

  it('字面量键重复 → 红（MODULE_EXTERNALS 注入重复 host 键——后键覆盖前键的静默死码形态）', () => {
    const mutatedDir = join(FIXTURE_ROOT, 'dup-key-script');
    mkdirSync(mutatedDir, { recursive: true });
    const mutatedPath = join(mutatedDir, 'check-topology.mjs');
    writeFileSync(
      mutatedPath,
      readFileSync(CHECK_SCRIPT, 'utf8').replace(
        'const MODULE_EXTERNALS = {',
        "const MODULE_EXTERNALS = {\n  host: ['typebox'],",
      ),
    );
    const root = fixture('dup-key-src', {
      'src/contracts/index.ts': 'export const x = 1;\n',
    });
    const r = spawnSync(process.execPath, [mutatedPath], {
      cwd: REPO_ROOT,
      env: { ...process.env, CHECK_TOPOLOGY_ROOT: root },
      encoding: 'utf8',
    });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    expect(r.status).toBe(1);
    expect(out).toContain('MODULE_EXTERNALS 字面量重复键');
    expect(out).toContain('host ×2');
    expect(out).toContain('静默死码');
  });
});
