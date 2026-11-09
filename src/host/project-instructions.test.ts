import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createProjectSectionBuilder,
  discoverProjectInstructions,
  renderProjectInstructions,
} from './project-instructions.js';

/* ---------------- 测试基建 ---------------- */

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function tmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** 造目录树并在指定层写文件（返回最深层工作区根） */
function makeTree(files: Record<string, string>): string {
  const root = tmpDir('proj-ws-');
  for (const [rel, text] of Object.entries(files)) {
    const target = join(root, rel);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, text);
  }
  return root;
}

/* ---------------- 发现器（03 §2.5 A4：最近者胜 / AGENTS.md 优先 / fail-open） ---------------- */

describe('discoverProjectInstructions（发现序）', () => {
  it('最近者胜：深层 AGENTS.md 优先于浅层（只装一份）', () => {
    const root = makeTree({
      'AGENTS.md': '根级指令',
      'sub/AGENTS.md': '子级指令',
    });
    const found = discoverProjectInstructions(join(root, 'sub'));
    expect(found.found?.text).toBe('子级指令');
    expect(found.found?.path).toBe(join(root, 'sub', 'AGENTS.md'));
  });

  it('同目录 AGENTS.md 优先于 CLAUDE.md（规范名优先、兼容回退）', () => {
    const root = makeTree({ 'AGENTS.md': '规范名', 'CLAUDE.md': '回退名' });
    const found = discoverProjectInstructions(root);
    expect(found.found?.text).toBe('规范名');
  });

  it('无 AGENTS.md 时回退同目录 CLAUDE.md；再向上逐级回退', () => {
    const root = makeTree({ 'CLAUDE.md': '根级回退', 'sub/.keep': '' });
    const found = discoverProjectInstructions(join(root, 'sub'));
    expect(found.found?.text).toBe('根级回退');
    expect(found.found?.path).toBe(join(root, 'CLAUDE.md'));
  });

  it('全程无命中 = found 缺席（零段诚实缺席——不注入空壳）', () => {
    const root = makeTree({ 'README.md': '不相干文件' });
    const found = discoverProjectInstructions(root);
    expect(found.found).toBeUndefined();
    expect(found.warnings).toEqual([]);
  });

  it('工作区根本身命中（startDir 即命中层——不先跳父级）', () => {
    const root = makeTree({ 'AGENTS.md': '本级指令' });
    const found = discoverProjectInstructions(root);
    expect(found.found?.text).toBe('本级指令');
  });

  it('非绝对路径 = 防御性无命中（调用方契约 = canonical 归一形）', () => {
    expect(discoverProjectInstructions('relative/dir').found).toBeUndefined();
  });
});

describe('discoverProjectInstructions（fail-open + 帽）', () => {
  it('候选读取失败 = warn 一条继续向上（增强面非正确性面——不抛出）', () => {
    const root = makeTree({ 'AGENTS.md': '根级指令', 'sub/.keep': '' });
    const sub = join(root, 'sub');
    // seam：sub/AGENTS.md 抛错（不可读/编码坏形）——继续向上命中根级
    const found = discoverProjectInstructions(sub, {
      isFile: (path) => path.endsWith('.md'),
      readBytes: (path) => {
        if (path === join(sub, 'AGENTS.md')) throw new Error('EACCES: permission denied');
        return Buffer.from('根级指令', 'utf8');
      },
    });
    expect(found.found?.text).toBe('根级指令');
    expect(found.warnings).toHaveLength(1);
    expect(found.warnings[0]).toContain(join(sub, 'AGENTS.md'));
  });

  it('超 64 KiB 截断 + truncated 位（截断披露行的判据位）', () => {
    const big = 'a'.repeat(64 * 1024 + 100);
    const root = makeTree({ 'AGENTS.md': big });
    const found = discoverProjectInstructions(root);
    expect(found.found?.truncated).toBe(true);
    expect(Buffer.byteLength(found.found?.text ?? '', 'utf8')).toBe(64 * 1024);
  });

  it('64 KiB 内不截断（边界恰好等于帽）', () => {
    const exact = 'b'.repeat(64 * 1024);
    const root = makeTree({ 'AGENTS.md': exact });
    const found = discoverProjectInstructions(root);
    expect(found.found?.truncated).toBe(false);
    expect(found.found?.text).toBe(exact);
  });
});

/* ---------------- 物化形（披露行 + fence 自适应） ---------------- */

describe('renderProjectInstructions（物化形）', () => {
  it('路径披露行 + 四反引号下限 fence 整嵌', () => {
    const text = renderProjectInstructions({ path: '/ws/AGENTS.md', text: '正文', truncated: false });
    expect(text.startsWith('项目指令（/ws/AGENTS.md）\n````\n正文\n````')).toBe(true);
  });

  it('原文自含 ``` 围栏时 fence 自适应加长（嵌套防破律）', () => {
    const content = '示例：\n```ts\nconst x = 1;\n```\n收尾';
    const text = renderProjectInstructions({ path: '/ws/AGENTS.md', text: content, truncated: false });
    // fence 须为四反引号（原文最长 3 + 1）——原文 ``` 不得提前闭合
    expect(text).toContain('\n````\n示例：');
    expect(text.endsWith('````')).toBe(true);
    expect(text.match(/`{4}/g)?.length).toBe(2); // 恰首尾两道（原文三反引号不匹配四连）
  });

  it('原文自含 ```` 四连围栏时升五反引号', () => {
    const content = '````inner````';
    const text = renderProjectInstructions({ path: '/ws/AGENTS.md', text: content, truncated: false });
    expect(text).toContain('`````');
  });

  it('截断形披露行（作者侧反馈律——静默截断禁止）', () => {
    const text = renderProjectInstructions({ path: '/ws/AGENTS.md', text: 'x', truncated: true });
    expect(text).toContain('已截断至前 64 KiB');
  });
});

/* ---------------- 段 builder（每会话懒冻结 / 空不冻结 / 零段缺席） ---------------- */

describe('createProjectSectionBuilder（段生命周期）', () => {
  it('会话锚缺席 = 空串且不冻结（锚迟到形下次重走——防早期空冻结钉死）', () => {
    const root = makeTree({ 'AGENTS.md': '项目约定正文' });
    const builder = createProjectSectionBuilder(
      (sessionId) => (sessionId === 's-known' ? root : undefined),
      () => {},
    );
    expect(builder('s-unknown')).toBe('');
    // 空结果未冻结的证据：同 builder 对已知会话物化即有产出
    expect(builder('s-known')).toContain('项目约定正文');
  });

  it('sessionId 缺席（诊断直物化形）= 空串（S-3 零段诚实缺席）', () => {
    const root = makeTree({ 'AGENTS.md': '正文' });
    const builder = createProjectSectionBuilder(
      () => root,
      () => {},
    );
    expect(builder(undefined)).toBe('');
  });

  it('命中即冻结：同会话两次物化字节恒定，盘上文件变更不热跟（懒冻结律）', () => {
    const root = makeTree({ 'AGENTS.md': '冻结正文' });
    const builder = createProjectSectionBuilder(
      () => root,
      () => {},
    );
    const first = builder('s-1')!;
    expect(first).toContain('冻结正文');
    const second = builder('s-1')!;
    expect(second).toBe(first);
    // 冻结证据：改盘上文件后再物化仍恒定（换代重发现走 /reload 新 registry）
    writeFileSync(join(root, 'AGENTS.md'), '改过的正文');
    expect(builder('s-1')).toBe(first);
  });

  it('无命中会话：空结果不冻结（文件后到形下次重走可命中）', () => {
    const root = makeTree({ 'keep.txt': '' });
    const builder = createProjectSectionBuilder(
      () => root,
      () => {},
    );
    expect(builder('s-2')).toBe('');
    writeFileSync(join(root, 'AGENTS.md'), '后到的指令');
    expect(builder('s-2')).toContain('后到的指令'); // 未被早期空结果钉死
  });

  it('发现 warning 经注入 warn 呈报（fail-open 不静默）', () => {
    const root = makeTree({ 'AGENTS.md': '根级' });
    const sub = join(root, 'sub');
    mkdirSync(sub);
    const warns: string[] = [];
    const builder = createProjectSectionBuilder(
      () => sub,
      (m) => warns.push(m),
    );
    // sub 层无候选、根层命中——正常路径零 warning（负断言）
    expect(builder('s-3')).toContain('根级');
    expect(warns).toEqual([]);
  });
});
