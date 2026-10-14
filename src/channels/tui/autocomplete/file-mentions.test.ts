/**
 * @ 文件段补全源单测（07 §4.1 补全三合一第三源——实机行走件）：
 * 根列举与前缀过滤（大小写不敏感）/ 子目录段 / 目录优先排序 /
 * 引号形（空格文件 + 已引号前缀续补）/ .git 跳过 / 缺目录空集 /
 * 帽 / 绝对路径与 ~ 展开 / 符号链目录归类 /
 * 全库异步腿（裸段深查命中 / 两腿分界 / union 形与空态透传 /
 * 排序律与截断披露行 / tui-entry 装配词法锁——挖掘 36 轮批）/
 * I5 锁① @ basePath 随焦锁（R7 批 10k——装配锚真源 = host/tui-entry.ts
 * mentionSourceFor 闭包：per-query 新铸源、basePath 取聚焦会话工作区根；
 * 焦点空悬/行缺席回退启动会话根。本组锁 FileMentionSource 的 basePath
 * 语义底座——双根两形：换根列举随根、同根（回退形）列举稳定）。
 */
import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { FileMentionSource } from './file-mentions.js';
import type { AutocompleteItem } from './provider.js';
import { isThenable } from './async.js';

/** 临时工程 rig（真实 fs 行走——实机语义） */
function makeTmpProject(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(path.join(tmpdir(), 'berry-agent-file-mentions-'));
  mkdirSync(path.join(root, 'src'));
  mkdirSync(path.join(root, '.git'));
  writeFileSync(path.join(root, 'package.json'), '{}');
  writeFileSync(path.join(root, 'README.md'), '');
  writeFileSync(path.join(root, 'my file.txt'), '');
  writeFileSync(path.join(root, 'src', 'app.ts'), '');
  writeFileSync(path.join(root, 'src', 'util.ts'), '');
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** 测试集合 rig（源 + 临时工程） */
function makeSource(maxItems?: number) {
  const project = makeTmpProject();
  const source = new FileMentionSource({ basePath: project.root, maxItems });
  return { ...project, source };
}

const homes: string[] = [];
afterAll(() => {
  for (const home of homes) rmSync(home, { recursive: true, force: true });
});

/**
 * 段导航同步腿取值：含 / 段、~ 形、绝对形、引号态、空 query 的运行时恒数组
 * （union 类型侧收窄断言——两腿分界测试锁分界判据本身）。
 */
const syncGet = (source: FileMentionSource, query: string): readonly AutocompleteItem[] =>
  source.get(query) as readonly AutocompleteItem[];

describe('FileMentionSource 列举与过滤', () => {
  it('空查询 = 根列举；.git 跳过；目录优先排序', () => {
    const { source, cleanup } = makeSource();
    try {
      const items = syncGet(source, '');
      const labels = items.map((item) => item.label);
      expect(labels).toContain('src/');
      expect(labels).toContain('package.json');
      expect(labels).toContain('my file.txt');
      expect(labels).not.toContain('.git'); // 版本库内脏不补
      // 目录优先：src/ 排在一切文件前
      expect(labels.indexOf('src/')).toBe(0);
    } finally {
      cleanup();
    }
  });

  it('前缀过滤（大小写不敏感）+ replacement 带 @ 前缀（裸段经全库异步腿）', async () => {
    const { source, cleanup } = makeSource();
    try {
      const items = await source.get('PACK'); // 裸段——union 全库腿
      expect(items.map((i) => i.label)).toEqual(['package.json']);
      expect(items[0]!.replacement).toBe('@package.json');
    } finally {
      cleanup();
    }
  });

  it('子目录段：dir 前缀解析 + 相对路径 replacement + 目录尾 /', async () => {
    const { source, cleanup } = makeSource();
    try {
      // 裸段 'sr' 走全库腿（收集面仅常规文件——src/ 目录不进索引，其下两文件子序列命中）
      expect((await source.get('sr')).map((i) => i.replacement)).toEqual(['@src/app.ts', '@src/util.ts']);
      expect(syncGet(source, 'src/ap').map((i) => i.replacement)).toEqual(['@src/app.ts']);
      expect(
        syncGet(source, 'src/')
          .map((i) => i.label)
          .sort(),
      ).toEqual(['app.ts', 'util.ts']); // 尾 / = 列目录
    } finally {
      cleanup();
    }
  });

  it('空格文件引号形：源侧包裹防尾空格击穿；已引号前缀续补', async () => {
    const { source, cleanup } = makeSource();
    try {
      expect((await source.get('my')).map((i) => i.replacement)).toEqual(['@"my file.txt"']); // 裸段全库腿引号形直出
      expect(syncGet(source, '"my f').map((i) => i.replacement)).toEqual(['@"my file.txt"']); // 引号态续补（同步腿）
      expect(syncGet(source, '"my file.txt"').map((i) => i.replacement)).toEqual(['@"my file.txt"']); // 已敲闭引号
    } finally {
      cleanup();
    }
  });

  it('缺目录 / 无命中 → 空集（无命中形经全库腿解析为 []）', async () => {
    const { source, cleanup } = makeSource();
    try {
      expect(syncGet(source, 'nope/x')).toEqual([]);
      expect(await source.get('zzz')).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it('条目帽（大目录防全量）', () => {
    const { source, cleanup } = makeSource(2);
    try {
      expect(syncGet(source, '').length).toBe(2); // 帽内截断（目录优先序保真）
    } finally {
      cleanup();
    }
  });
});

describe('FileMentionSource 路径形态', () => {
  it('绝对路径段：按绝对位列举 + replacement 保留绝对形', () => {
    const { source, root, cleanup } = makeSource();
    try {
      const items = syncGet(source, `${root}/pack`);
      expect(items.map((i) => i.replacement)).toEqual([`@${root}/package.json`]);
    } finally {
      cleanup();
    }
  });

  it('~ 展开家目录（~/ 段与 ~ 根列举）', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'berry-agent-home-'));
    homes.push(home);
    const prevHome = process.env.HOME;
    process.env.HOME = home; // POSIX homedir() 读 HOME
    writeFileSync(path.join(home, 'notes.md'), '');
    const { source, cleanup } = makeSource();
    try {
      // replacement 保 ~/ 形（承 berry「Preserve ~/ format」——短形续补，
      // 展开责任归下游读取面）。~ 形运行时恒同步数组（syncGet 收窄断言）
      expect(syncGet(source, '~/notes').map((i) => i.replacement)).toEqual(['@~/notes.md']);
      expect(syncGet(source, '~/').map((i) => i.label)).toContain('notes.md'); // '~/' 根列举
      expect(syncGet(source, '~').map((i) => i.label)).toContain('notes.md'); // '~' 裸形同根列举
    } finally {
      cleanup();
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
    }
  });

  it('符号链指目录归类为目录（label 尾 /）；全库腿符号链不入索引', async () => {
    const { source, root, cleanup } = makeSource();
    try {
      symlinkSync(path.join(root, 'src'), path.join(root, 'link-to-src'));
      // 段导航腿：符号链指目录归类目录（尾 / 续深——目录经段导航腿可达；
      // 含 / 段运行时恒同步数组——union 类型侧收窄断言）
      expect((source.get('link-to-src/') as readonly AutocompleteItem[]).map((i) => i.replacement)).toEqual([
        '@link-to-src/app.ts',
        '@link-to-src/util.ts',
      ]);
      // 全库腿：裸段查询索引不含符号链（行走不跟随——收集面仅常规文件）
      expect(await source.get('link')).toEqual([]);
    } finally {
      cleanup();
    }
  });
});

describe('I5 锁① @ basePath 随焦（R7 批 10k——装配锚 host/tui-entry.ts mentionSourceFor 闭包）', () => {
  /**
   * 双根 rig：rootA / rootB 各铸独有文件。mentionSourceFor 的 per-query 新铸
   * 语义（每查询新 FileMentionSource、basePath 取当下聚焦根）在此以「换根 =
   * 换源实例」形投影——锁的是 basePath 语义底座：列举严格随 basePath、
   * 跨根零泄漏、同根（回退形）稳定。
   */
  function makeDualRoots(): { rootA: string; rootB: string; cleanup: () => void } {
    const rootA = mkdtempSync(path.join(tmpdir(), 'berry-agent-lock-a-'));
    const rootB = mkdtempSync(path.join(tmpdir(), 'berry-agent-lock-b-'));
    writeFileSync(path.join(rootA, 'only-in-a.md'), '');
    writeFileSync(path.join(rootB, 'only-in-b.md'), '');
    return {
      rootA,
      rootB,
      cleanup: () => {
        rmSync(rootA, { recursive: true, force: true });
        rmSync(rootB, { recursive: true, force: true });
      },
    };
  }

  it('切焦随新根：basePath rootA 的源列 rootA 独有且不含 rootB 独有（反向同理）', async () => {
    const { rootA, rootB, cleanup } = makeDualRoots();
    try {
      // 聚焦会话 A：mentionSourceFor 铸 basePath = A 工作区根的源（裸段经全库腿）
      const fromA = await new FileMentionSource({ basePath: rootA }).get('only-in-');
      expect(fromA.map((i) => i.replacement)).toEqual(['@only-in-a.md']); // A 独有在场
      // 切焦会话 B：per-query 新铸 basePath = B 根——列举随根换代（A 独有不残留）
      const fromB = await new FileMentionSource({ basePath: rootB }).get('only-in-');
      expect(fromB.map((i) => i.replacement)).toEqual(['@only-in-b.md']);
    } finally {
      cleanup();
    }
  });

  it('焦点空悬回退：basePath = 启动会话根——同根两铸列举稳定（回退形不漂移）', () => {
    const { rootA, cleanup } = makeDualRoots();
    try {
      // 空悬/行缺席两形都回退启动根——同根连续两铸（per-query 新铸不引入漂移；
      // 空 query 走段导航同步腿——两铸同列举即稳定锚）。union 面下空 query
      // 运行时恒同步数组，类型侧收窄断言（isThenable 分界测试另锁两腿分界）
      const first = new FileMentionSource({ basePath: rootA }).get('');
      const second = new FileMentionSource({ basePath: rootA }).get('');
      const toLabels = (items: readonly AutocompleteItem[] | Promise<readonly AutocompleteItem[]>) =>
        (items as readonly AutocompleteItem[]).map((i) => i.label);
      expect(toLabels(first)).toEqual(['only-in-a.md']);
      expect(toLabels(second)).toEqual(toLabels(first)); // 同根 = 同列举
    } finally {
      cleanup();
    }
  });
});

describe('FileMentionSource 全库异步腿（07 §4.1 @ 文件全库模糊腿批——挖掘 36 轮）', () => {
  /** 深树 rig：src/x/y/target-file.ts（深层文件——段导航腿根列举不可达） */
  function makeDeepProject(): { root: string; source: FileMentionSource; cleanup: () => void } {
    const root = mkdtempSync(path.join(tmpdir(), 'berry-agent-file-deep-'));
    mkdirSync(path.join(root, 'src', 'x', 'y'), { recursive: true });
    writeFileSync(path.join(root, 'src', 'x', 'y', 'target-file.ts'), '');
    const source = new FileMentionSource({ basePath: root });
    return { root, source, cleanup: () => rmSync(root, { recursive: true, force: true }) };
  }

  it('全库腿触发与命中：裸段深查命中深层文件（label = 完整相对路径、replacement = @+相对路径）【修前红：现行段导航根列举无此名返 []】', async () => {
    const { source, cleanup } = makeDeepProject();
    try {
      const sub = await source.get('tgfile'); // 子序列命中（t-g-f-i-l-e 按序散布全路径）
      expect(sub).toHaveLength(1);
      expect(sub[0]!.label).toBe('src/x/y/target-file.ts');
      expect(sub[0]!.replacement).toBe('@src/x/y/target-file.ts');
      expect((await source.get('target-file')).map((i) => i.replacement)).toEqual(['@src/x/y/target-file.ts']);
    } finally {
      cleanup();
    }
  });

  it('两腿分界不回归：含 / 段、~ 形、绝对形、引号形、空 query 均走段导航同步腿（数组非 thenable）', () => {
    const { source, cleanup } = makeSource();
    try {
      for (const query of ['', 'src/', 'src/ap', '/abs', '"my f', '~', '~/']) {
        expect(isThenable(source.get(query))).toBe(false); // 同步快路零扰动
      }
    } finally {
      cleanup();
    }
  });

  it('union 形与空态透传：全库腿返 thenable；无命中解析为 []（源在场条目空透传，非 null）', async () => {
    const { source, cleanup } = makeSource();
    try {
      const outcome = source.get('zzz');
      expect(isThenable(outcome)).toBe(true);
      expect(await outcome).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it('排序律与截断披露行：前缀置顶、子序列随后；组内深度浅先、同深字典序；超帽披露行 replacement = 当前 token 自反形', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'berry-agent-file-order-'));
    writeFileSync(path.join(root, 'ap.ts'), ''); // d1 前缀命中（全路径 startsWith）
    writeFileSync(path.join(root, 'azp.ts'), ''); // d1 子序列
    writeFileSync(path.join(root, 'zz-ap.ts'), ''); // d1 子序列
    mkdirSync(path.join(root, 'mid'));
    writeFileSync(path.join(root, 'mid', 'ap.ts'), ''); // d2 子序列（深于 d1 子序列组——组内序末位）
    const source = new FileMentionSource({ basePath: root }); // 不设帽——全序四命中可见
    try {
      // 排序律（无帽形）：前缀组 ['ap.ts'] 置顶；子序列组内 d1 字典序
      // （azp < zz-ap）先于 d2（mid/）——组内序 = 索引源序不重排
      const items = await source.get('ap');
      expect(items.map((i) => i.label)).toEqual(['ap.ts', 'azp.ts', 'zz-ap.ts', 'mid/ap.ts']);
      // 帽 3（独立源）：前 3 条目 + 披露行（label 含「仅示前」计数、
      // replacement = @+query 自反形——enter 应用即零净代换，enter 全量输入
      // 穿透律承载）
      const capped = await new FileMentionSource({ basePath: root, maxItems: 3 }).get('ap');
      expect(capped.map((i) => i.label)).toEqual(['ap.ts', 'azp.ts', 'zz-ap.ts', '仅示前 3 条（共 4 命中）']);
      expect(capped.length).toBe(4);
      expect(capped[3]!.label).toContain('仅示前 3');
      expect(capped[3]!.label).toContain('共 4');
      expect(capped[3]!.replacement).toBe('@ap');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('词法锁——tui-entry 装配 lambda 透传 signal【修前红：现行 lambda 无 signal 形】', () => {
    // 防装配缺口（ASM-1 族）：signal 线传面（autocomplete.ts sources.mentions）单测
    // 恒绿而装配丢参的假绿形——锁装配位源文恰一命中（词法锁 count==1 谱，宽松
    // 空白正则防格式化变体破锁）
    const source = readFileSync(new URL('../../../host/tui-entry.ts', import.meta.url), 'utf8');
    const pattern = /mentions:\s*\(query,\s*signal\)\s*=>\s*mentionSourceFor\(\)\.get\(query,\s*signal\)/g;
    expect(source.match(pattern)?.length ?? 0).toBe(1);
  });
});
