import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * build 链恒清回归锁（2026-10-18 批次 4 裁决一；立题档 00-立题-core件迁
 * plugins目录-20261016 批次 4）——④迁移批 ROUTE A rootDir 仓根化（产物
 * dist/src/** + dist/plugins/** 双区布局）后，增量 tsc 构建会留旧布局孤儿
 * 目录静默混入发布物（本地 dist alias 用户零感知拿到混布局），根治 =
 * build 脚本前置恒清各包 dist（正确性优先、每次全量重建；dev 路径 tsc
 * watch 不挂在 build 脚本上、不受影响）。
 *
 * 两腿锁（缺恒清时机械腿先红——build 串抽不出清命令即修前红形态）：
 * - 机械腿：package.json build 串真含清命令、且序在一切写 dist 步之前
 *   （root build：先于 build:webui〔vite 向 dist 写 SPA〕与 tsc；root
 *   build:sdk 与 SDK 包 build：先于各自 tsc——清在写后即无效）；形限
 *   node -e rmSync（可移植律：npm script 内 rm -rf 在 Windows 不通）。
 * - 行为腿：从 build 串原样抽出 node -e 清命令、真跑于种子孤儿夹具
 *   （spawn 形与 npm script 同形——不手工复刻清逻辑，锁的是命令字面
 *   本身真能删孤儿；旁观源码存活证清射界恰为 dist、不误伤源码面）。
 */
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** 读包描述符（JSON 真解析——锁真源，不锁字符串快照） */
function readPkg(rel) {
  return JSON.parse(readFileSync(join(REPO_ROOT, rel), 'utf8'));
}

/** 从 npm script 串抽出 node -e 清命令源码（无即 null——机械腿红位） */
function extractClean(script) {
  const m = /node -e "([^"]+)"/.exec(script);
  return m ? m[1] : null;
}

/** 断言清命令形：rmSync 目标目录 + recursive/force 双开关（force 兜缺席不炸） */
function assertCleanShape(clean, target) {
  expect(clean).toContain(`rmSync('${target}'`);
  expect(clean).toContain('recursive:true');
  expect(clean).toContain('force:true');
}

describe('build 链恒清——机械腿（build 串含清前缀且序在最前）', () => {
  it('root build：恒清仓根 dist 前置于 build:webui 与 tsc（两步都向 dist 写——清必须更前）', () => {
    const build = readPkg('package.json').scripts.build;
    expect(build).not.toContain('rm -rf');
    const clean = extractClean(build);
    expect(clean).not.toBeNull();
    assertCleanShape(clean, 'dist');
    const cleanIdx = build.indexOf('node -e ');
    expect(cleanIdx).toBeGreaterThanOrEqual(0);
    expect(cleanIdx).toBeLessThan(build.indexOf('build:webui'));
    expect(cleanIdx).toBeLessThan(build.indexOf('tsc '));
  });

  it('root build:sdk：恒清 SDK 包内 dist（相对仓根全路径）前置于 tsc', () => {
    const script = readPkg('package.json').scripts['build:sdk'];
    expect(script).not.toContain('rm -rf');
    const clean = extractClean(script);
    expect(clean).not.toBeNull();
    // cwd = 仓根（root 侧包装脚本）——目标须相对仓根全路径，防误清仓顶 dist
    assertCleanShape(clean, 'packages/berry-agent-sdk/dist');
    expect(script.indexOf('node -e ')).toBeLessThan(script.indexOf('tsc '));
  });

  it('SDK 包 build：恒清包内 dist（cwd = 包目录的相对形）前置于 tsc', () => {
    const build = readPkg('packages/berry-agent-sdk/package.json').scripts.build;
    expect(build).not.toContain('rm -rf');
    const clean = extractClean(build);
    expect(clean).not.toBeNull();
    assertCleanShape(clean, 'dist');
    expect(build.indexOf('node -e ')).toBeLessThan(build.indexOf('tsc '));
  });
});

describe('build 链恒清——行为腿（清命令字面真能删种子孤儿）', () => {
  /**
   * 夹具真跑清命令：种子孤儿树 + 旁观源码，spawn node -e（argv 直传不经
   * shell——与 npm script 同一求值面），cwd 即该脚本的包根语义位；回执
   * 退出码 + 孤儿删否 + 旁观存否。
   */
  function runClean(cleanCode, seedRels, orphanRel, bystanderRel) {
    const root = mkdtempSync(join(tmpdir(), 'build-clean-test-'));
    try {
      for (const rel of seedRels) {
        const p = join(root, rel);
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, 'x\n');
      }
      const r = spawnSync(process.execPath, ['-e', cleanCode], { cwd: root, encoding: 'utf8' });
      return {
        status: r.status ?? -1,
        orphanGone: !existsSync(join(root, orphanRel)),
        bystanderKept: existsSync(join(root, bystanderRel)),
        stderr: (r.stderr ?? '').trim(),
      };
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  it('root build 清命令：删旧布局孤儿（dist/src/<已迁件>/）且不伤仓内源码', () => {
    const clean = extractClean(readPkg('package.json').scripts.build);
    expect(clean).not.toBeNull();
    const r = runClean(
      clean,
      ['dist/src/browser/orphan.js', 'dist/src/host/main.js', 'src/host/main.ts'],
      'dist/src/browser/orphan.js',
      'src/host/main.ts',
    );
    expect(r.status).toBe(0);
    expect(r.orphanGone).toBe(true);
    expect(r.bystanderKept).toBe(true);
  });

  it('root build:sdk 清命令：删 SDK 侧孤儿（dist/src/sdk——实见孤儿形）且不伤包源码', () => {
    const clean = extractClean(readPkg('package.json').scripts['build:sdk']);
    expect(clean).not.toBeNull();
    const r = runClean(
      clean,
      ['packages/berry-agent-sdk/dist/src/sdk/orphan.js', 'packages/berry-agent-sdk/src/index.ts'],
      'packages/berry-agent-sdk/dist/src/sdk/orphan.js',
      'packages/berry-agent-sdk/src/index.ts',
    );
    expect(r.status).toBe(0);
    expect(r.orphanGone).toBe(true);
    expect(r.bystanderKept).toBe(true);
  });

  it('SDK 包 build 清命令：cwd 包目录语义下删包内 dist 孤儿且不伤 src', () => {
    const clean = extractClean(readPkg('packages/berry-agent-sdk/package.json').scripts.build);
    expect(clean).not.toBeNull();
    const r = runClean(clean, ['dist/src/sdk/orphan.js', 'src/index.ts'], 'dist/src/sdk/orphan.js', 'src/index.ts');
    expect(r.status).toBe(0);
    expect(r.orphanGone).toBe(true);
    expect(r.bystanderKept).toBe(true);
  });
});
