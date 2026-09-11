/**
 * testkit 自举测试（03 §9.5 examples 双重身份第二重——生态启动批 eco-3c）。
 *
 * 矩阵断言器对真模板（examples/ 两形）跑全绿、对坏样本（default-export
 * 形两向/逃逸路径形/缺清单形）跑必红；变异验证 = 作者声明面喂假命令名
 * （摘断言器谓词活性的实操形——谓词死则该行假绿，07 §7.5 回归锁同律延伸）。
 * 好样本两例走真 npm pack（pack 完整性预检真链）；坏样本 packCheck 关
 * （所证面在装载拒，非 pack——去 spawn 省时且确定性）。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import { formatMatrixReceipt, proveLifecycleMatrix } from './index.js';
import type { LifecycleMatrixReport, MatrixRowResult } from './index.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const codeExample = join(repoRoot, 'examples', 'minimal-code-plugin');
const skillExample = join(repoRoot, 'examples', 'pure-skill-pack');

/** 临时目录族（统一清） */
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 坏样本铸造（tmp 真盘） */
function makeBadSample(build: (dir: string) => void): string {
  const dir = mkdtempSync(join(tmpdir(), 'testkit-bad-'));
  dirs.push(dir);
  build(dir);
  return dir;
}

/** 行名取器（fail 定位 + 行集完整性锁共用） */
function rowOf(report: LifecycleMatrixReport, name: string): MatrixRowResult {
  const row = report.rows.find((r) => r.row.startsWith(name));
  if (row === undefined) throw new Error(`矩阵缺行（${name}）——行集漂移`);
  return row;
}

describe('testkit 生命周期证明矩阵——examples 真模板全绿', () => {
  it('minimal-code-plugin（代码插件形）：八行全绿 + 真注册账断言（example-hello）', async () => {
    const report = await proveLifecycleMatrix({
      pluginDir: codeExample,
      expect: { commands: ['example-hello'] },
    });
    expect(report.ok).toBe(true);
    // 首版矩阵行集完整性锁（八行——行集漂移即红）
    expect(report.rows.map((r) => r.row)).toEqual([
      'install（装机 + pack 完整性）',
      'mount（真装载 activated + 注册账在场）',
      '事件面（plugin/mounted 恰一笔）',
      '幂等/负向（换代不双注 + mountRow 撞名拒）',
      'toggle（行翻转两断言）',
      '开门面（plugin/opens 幂等 diff）',
      'unmount（disposer 回卷 + 注册账缺席）',
      '残留检查（审计词 + 数据面双白名单）',
    ]);
    expect(report.pluginId).toBe('berry-agent-example-minimal-code');
  }, 120_000);

  it('pure-skill-pack（纯声明形）：八行全绿（技能目录账与清单声明同长）', async () => {
    const report = await proveLifecycleMatrix({ pluginDir: skillExample });
    expect(report.ok).toBe(true);
    expect(report.rows.every((r) => r.status === 'pass')).toBe(true);
    expect(report.pluginId).toBe('berry-agent-example-pure-skill');
  }, 120_000);
});

describe('testkit 矩阵——坏样本必红（03 §9.5 default-export 陷阱 + 逃逸 + 缺清单）', () => {
  it('代码插件误漏 default export → mount 行红（真 jiti 求值当场拒）', async () => {
    const dir = makeBadSample((d) => {
      writeFileSync(
        join(d, 'package.json'),
        JSON.stringify({ name: 'bad-nodefault', version: '1.0.0', berryAgent: { entry: 'entry.js' } }),
      );
      writeFileSync(join(d, 'entry.js'), 'export const inject = [];\n');
    });
    const report = await proveLifecycleMatrix({ pluginDir: dir, packCheck: false });
    expect(report.ok).toBe(false);
    const mount = rowOf(report, 'mount');
    expect(mount.status).toBe('fail');
    expect(mount.detail).toContain('default export');
  });

  it('纯声明包误带 default export（main 指向函数）→ install 行红（stray 探针）', async () => {
    const dir = makeBadSample((d) => {
      writeFileSync(
        join(d, 'package.json'),
        JSON.stringify({
          name: 'bad-stray-default',
          version: '1.0.0',
          main: 'index.js',
          berryAgent: { skills: ['skills'] },
        }),
      );
      writeFileSync(join(d, 'index.js'), 'export default async () => undefined;\n');
      mkdirSync(join(d, 'skills', 'demo-skill'), { recursive: true });
      writeFileSync(
        join(d, 'skills', 'demo-skill', 'SKILL.md'),
        '---\nname: demo-skill\ndescription: 坏样本技能\n---\n\n正文\n',
      );
    });
    const report = await proveLifecycleMatrix({ pluginDir: dir, packCheck: false });
    expect(report.ok).toBe(false);
    const install = rowOf(report, 'install');
    expect(install.status).toBe('fail');
    expect(install.detail).toContain('default export');
  });

  it('声明载荷目录逃逸包根（skills: ["../outside"]）→ mount 行红', async () => {
    const dir = makeBadSample((d) => {
      writeFileSync(
        join(d, 'package.json'),
        JSON.stringify({
          name: 'bad-escape',
          version: '1.0.0',
          berryAgent: { entry: 'entry.js', skills: ['../outside'] },
        }),
      );
      writeFileSync(join(d, 'entry.js'), 'export default async () => undefined;\n');
    });
    const report = await proveLifecycleMatrix({ pluginDir: dir, packCheck: false });
    expect(report.ok).toBe(false);
    const mount = rowOf(report, 'mount');
    expect(mount.status).toBe('fail');
    expect(mount.detail).toContain('逃逸');
  });

  it('缺 package.json（非插件目录）→ install 行红（构造即红收面）', async () => {
    const dir = makeBadSample(() => undefined); // 空目录
    const report = await proveLifecycleMatrix({ pluginDir: dir, packCheck: false });
    expect(report.ok).toBe(false);
    const install = rowOf(report, 'install');
    expect(install.status).toBe('fail');
    expect(install.detail).toContain('package.json');
  });

  it('变异验证：作者声明面喂假命令名 → mount 行红（谓词活性——摘断言器必红）', async () => {
    const report = await proveLifecycleMatrix({
      pluginDir: codeExample,
      expect: { commands: ['never-registered'] },
      packCheck: false,
    });
    expect(report.ok).toBe(false);
    const mount = rowOf(report, 'mount');
    expect(mount.status).toBe('fail');
    expect(mount.detail).toContain('never-registered');
  });

  it('回执形：全绿回执含行名与 ✅；红回执含 ❌ 与 detail（可贴 README 面）', async () => {
    const red = await proveLifecycleMatrix({
      pluginDir: codeExample,
      expect: { commands: ['never-registered'] },
      packCheck: false,
    });
    const receipt = formatMatrixReceipt(red);
    expect(receipt).toContain('berry-agent-example-minimal-code');
    expect(receipt).toContain('❌');
    expect(receipt).toContain('never-registered');
    expect(receipt).toContain('unmount（disposer 回卷 + 注册账缺席）');
  });
});
