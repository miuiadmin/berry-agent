/**
 * 发现层测试（06 §11.4——真 FS 临时目录；gitignore 判据与检索族同笔同判的
 * 回归锁在「basename 深层匹配」例）。零网络；symlink 例 macOS/Linux 双平台可跑。
 */
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createDirProvider, createStandardLayers, resolveFactorySkillsDir, scanSkillsDir } from './discovery.js';
import { createSkillsRegistry } from './registry.js';

const cleanups: string[] = [];
afterEach(async () => {
  await Promise.all(cleanups.map((dir) => rm(dir, { recursive: true, force: true })));
  cleanups.length = 0;
});

/** 新临时根 */
async function tmpRoot(tag: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `berry-skills-${tag}-`));
  cleanups.push(dir);
  return dir;
}

/** 落一枚技能（返回技能目录） */
async function writeSkill(root: string, name: string, description = `${name} 技能`): Promise<string> {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n${name} 正文。\n`,
    'utf8',
  );
  return dir;
}

describe('scanSkillsDir 目录扫描', () => {
  it('目录含 SKILL.md 即技能根——不再下钻（根内嵌套技能目录不被发现）', async () => {
    const root = await tmpRoot('root');
    const dir = await writeSkill(root, 'outer');
    await writeSkill(dir, 'inner'); // outer/SKILL.md 在场 → outer 即技能根，inner 不扫
    const scan = await scanSkillsDir(root, { providerId: 'test' });
    expect(scan.skills.map((s) => s.name)).toEqual(['outer']);
  });

  it('嵌套发现——无 SKILL.md 的中间目录递归下钻', async () => {
    const root = await tmpRoot('nest');
    await writeSkill(join(root, 'group', 'sub'), 'deep');
    const scan = await scanSkillsDir(root, { providerId: 'test' });
    expect(scan.skills.map((s) => s.name)).toEqual(['deep']);
  });

  it('缺席目录 = 空结果零诊断（跨库目录常态缺席）', async () => {
    const scan = await scanSkillsDir(join(await tmpRoot('absent'), 'nope'), { providerId: 'test' });
    expect(scan.skills).toEqual([]);
    expect(scan.diagnostics).toEqual([]);
  });

  it('坏 frontmatter 文件 → 跳过 + invalid-metadata 诊断（坏文件不炸装载）', async () => {
    const root = await tmpRoot('bad');
    const dir = join(root, 'bad');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'SKILL.md'), 'not a skill at all\n', 'utf8');
    const scan = await scanSkillsDir(root, { providerId: 'test' });
    expect(scan.skills).toEqual([]);
    expect(scan.diagnostics[0]?.type).toBe('invalid-metadata');
  });

  it('gitignore basename 形匹配深层技能目录（与检索族同笔同判——回归锁）', async () => {
    const root = await tmpRoot('ignore-basename');
    await writeFile(join(root, '.gitignore'), 'secret\n', 'utf8');
    await writeSkill(root, 'keep');
    await writeSkill(join(root, 'nested'), 'secret'); // 纯 basename 模式须配到深层
    const scan = await scanSkillsDir(root, { providerId: 'test' });
    expect(scan.skills.map((s) => s.name)).toEqual(['keep']);
  });

  it('gitignore 锚定形只作用本层（/top/ 不杀深层同名）', async () => {
    const root = await tmpRoot('ignore-anchored');
    await writeFile(join(root, '.gitignore'), '/top/\n', 'utf8');
    await writeSkill(root, 'top'); // 本层被锚定忽略
    await writeSkill(join(root, 'other'), 'top'); // 深层同名不受影响
    const scan = await scanSkillsDir(root, { providerId: 'test' });
    expect(scan.skills.map((s) => s.name)).toEqual(['top']);
    expect(scan.skills[0]?.filePath).toContain(join(root, 'other'));
  });

  it('gitignore 否定形（!）再纳入', async () => {
    const root = await tmpRoot('ignore-negate');
    await writeFile(join(root, '.gitignore'), 'gen/*\n!gen/keep\n', 'utf8');
    await writeSkill(join(root, 'gen'), 'keep');
    await writeSkill(join(root, 'gen'), 'drop');
    const scan = await scanSkillsDir(root, { providerId: 'test' });
    expect(scan.skills.map((s) => s.name)).toEqual(['keep']);
  });

  it('node_modules 与 .git 剪枝', async () => {
    const root = await tmpRoot('prune');
    await writeSkill(join(root, 'node_modules'), 'dep');
    await writeSkill(join(root, '.git'), 'meta');
    await writeSkill(root, 'keep');
    const scan = await scanSkillsDir(root, { providerId: 'test' });
    expect(scan.skills.map((s) => s.name)).toEqual(['keep']);
  });

  it('symlink realpath 去重——同文件双根发现只装载一次', async () => {
    const real = await tmpRoot('real');
    await writeSkill(real, 'shared');
    const linkRoot = await tmpRoot('link');
    await symlink(real, join(linkRoot, 'shared-link'));
    const seen = new Set<string>();
    const a = await scanSkillsDir(real, { providerId: 'a', seenRealPaths: seen });
    const b = await scanSkillsDir(linkRoot, { providerId: 'b', seenRealPaths: seen });
    expect(a.skills).toHaveLength(1);
    expect(b.skills).toEqual([]); // realpath 已见——静默去重
  });

  it('断链 symlink 跳过不抛', async () => {
    const root = await tmpRoot('broken');
    await symlink(join(root, 'does-not-exist'), join(root, 'dangling'));
    const scan = await scanSkillsDir(root, { providerId: 'test' });
    expect(scan.skills).toEqual([]);
    expect(scan.diagnostics).toEqual([]);
  });
});

describe('createDirProvider 目录 provider', () => {
  it('trusted=false → 整层跳过 + 单诊断（装载不激活）', async () => {
    const root = await tmpRoot('untrusted');
    await writeSkill(root, 'secret');
    const provider = createDirProvider({ id: 'project', roots: [root], trusted: false });
    const scan = await provider.scan();
    expect(scan.skills).toEqual([]);
    expect(scan.diagnostics).toHaveLength(1);
    expect(scan.diagnostics[0]?.message).toContain('目录信任');
  });

  it('writable/trusted 标记透传到 provider 面', () => {
    const provider = createDirProvider({ id: 'project', roots: ['/w'], writable: true, trusted: true });
    expect(provider.writable).toBe(true);
    expect(provider.trusted).toBe(true);
  });
});

describe('createStandardLayers 六位层序', () => {
  it('层序 = project > user > cross-repo > plugin > factory；project 锚 canonical 工作区根', async () => {
    const ws = await tmpRoot('ws'); // 假工作区（无 .git——canonical 根 = 自身）
    const dataDir = await tmpRoot('data');
    const home = await tmpRoot('home');
    const plugDir = await tmpRoot('plug');
    const factory = await tmpRoot('factory');
    await writeSkill(join(ws, '.agents', 'skills'), 'from-project');
    await writeSkill(join(dataDir, 'skills'), 'from-user');
    await writeSkill(join(home, '.agents', 'skills'), 'from-cross');
    await writeSkill(plugDir, 'from-plug');
    await writeSkill(factory, 'from-factory');
    const layers = createStandardLayers({
      cwd: ws,
      dataDir,
      homeDir: home,
      pluginLayers: [{ id: 'plug', roots: [plugDir] }],
      factoryDir: factory,
    });
    // 注册序即优先序
    expect(layers.map((l) => l.id)).toEqual(['project', 'user', 'cross-repo', 'plug', 'factory']);
    const names: string[] = [];
    for (const layer of layers) names.push(...(await layer.scan()).skills.map((s) => s.name));
    expect(names.sort()).toEqual(['from-cross', 'from-factory', 'from-plug', 'from-project', 'from-user']);
    // project 层根锚 canonical 工作区根（cwd 即根时 = cwd/.agents/skills）
    expect(layers[0]?.roots[0]).toBe(join(ws, '.agents', 'skills'));
    expect(existsSync(layers[0]?.roots[0] ?? '')).toBe(true);
  });

  it('pass 域去重集——同轮扫描层间同文件只装一次（registry.refresh 透传形）', async () => {
    const dir = await tmpRoot('shared');
    await writeSkill(dir, 'same');
    const home = await tmpRoot('home-isolated'); // 隔离假家目录——不触真实 HOME
    const layers = createStandardLayers({
      cwd: dir,
      dataDir: join(dir, 'data'),
      homeDir: home,
      pluginLayers: [{ id: 'plug', roots: [dir] }],
      factoryDir: dir,
    });
    // registry.refresh 每 pass 铸新集透传各层（此处直扫等价表达——一集贯全程）
    const passSeen = new Set<string>();
    const names: string[] = [];
    for (const layer of layers) names.push(...(await layer.scan(passSeen)).skills.map((s) => s.name));
    expect(names.filter((n) => n === 'same')).toHaveLength(1); // 插件层与出厂层同根去重
    // 独立集（缺省形）各自完整扫描——层间同名兜底归 first-wins + collision 诊断
    const independent: string[] = [];
    for (const layer of layers) independent.push(...(await layer.scan()).skills.map((s) => s.name));
    expect(independent.filter((n) => n === 'same')).toHaveLength(2);
  });

  it('dataDir 缺席跳过 user 层（批 19b-1 :memory: 装载形——余四位照常构造）', async () => {
    const home = await tmpRoot('home-nouser');
    const factory = await tmpRoot('factory-nouser');
    const layers = createStandardLayers({
      cwd: await tmpRoot('ws-nouser'),
      homeDir: home,
      factoryDir: factory,
    });
    expect(layers.map((l) => l.id)).toEqual(['project', 'cross-repo', 'factory']);
  });
});

describe('refresh 全量重扫与 pass 域去重（装配双 refresh 清册回归锁）', () => {
  it('双 refresh 技能存活——去重集 pass 域不跨 refresh 残留（resyncPluginSkillLayers/skill_manage 写后刷新共用径）', async () => {
    const ws = await tmpRoot('ws-2r');
    const dataDir = await tmpRoot('data-2r');
    const home = await tmpRoot('home-2r');
    const factory = await tmpRoot('factory-2r');
    await writeSkill(join(ws, '.agents', 'skills'), 'from-project');
    await writeSkill(join(dataDir, 'skills'), 'from-user');
    await writeSkill(factory, 'from-factory');
    const registry = createSkillsRegistry();
    for (const layer of createStandardLayers({ cwd: ws, dataDir, homeDir: home, factoryDir: factory })) {
      registry.registerProvider(layer);
    }
    const first = await registry.refresh();
    expect(first.total).toBe(3);
    // 第二次 refresh（装配尾 resync / skill_manage 写后刷新等价形）——曾因
    // 跨 refresh 持久共享 seen 集而整册静默清空（realpath 已见即跳过）
    const second = await registry.refresh();
    expect(second.total).toBe(3);
    expect(
      registry
        .list()
        .map((s) => s.name)
        .sort(),
    ).toEqual(['from-factory', 'from-project', 'from-user']);
    // 写后刷新等价形：新落技能第三 refresh 可见（skill_manage create 后自动刷新）
    await writeSkill(join(dataDir, 'skills'), 'late-skill');
    const third = await registry.refresh();
    expect(third.total).toBe(4);
    expect(registry.get('late-skill')).toBeDefined();
  });
});

describe('resolveFactorySkillsDir 出厂目录定位', () => {
  it('发现模块位置上推两级 = 包根/skills（src 与 dist 双形态同构）', () => {
    expect(resolveFactorySkillsDir(pathToFileURL('/pkg/dist/skills/discovery.js').href)).toBe(join('/pkg', 'skills'));
    expect(resolveFactorySkillsDir(pathToFileURL('/pkg/src/skills/discovery.js').href)).toBe(join('/pkg', 'skills'));
  });
});

/**
 * 出厂技能四件回归锁（07 §8.6 定名批落位——2026-09-15）。
 *
 * 三面锁：
 * 1. 出厂真目录装载面——四件全在场且零诊断（frontmatter 全绿，name 与目录
 *    基名一致——落位批冷读 F2 的机器验收位）；
 * 2. 出厂名参数化解析——06 §11.4「凡文档引用的技能名必须解析到真实
 *    SKILL.md」的四名承载（07 §8.6 射程注记③：本节四件名即首批被锁引用）；
 * 3. user 层同名压过出厂件——优先级真源序（06 §11.4：project > user >
 *    跨库 > 插件 > 出厂，同名 first-wins 吸收 + collision 诊断）。
 */
describe('出厂技能四件（07 §8.6 落位批回归锁）', () => {
  /** 出厂四件名单（07 §8.6 单源——与 tools/release.mjs MAIN_PACK_MUST 必在件同源） */
  const FACTORY_SKILL_NAMES = ['coding-persona', 'plugins-quickstart', 'goal-unattended', 'memory-tools'];

  it('出厂真目录装载——恰四件全在场、零诊断', async () => {
    const factoryDir = resolveFactorySkillsDir();
    // 落位后缺席即红（不再 skip 形——「在场必在」，07 §8.6 射程注记④同向）
    expect(existsSync(factoryDir)).toBe(true);
    const scan = await scanSkillsDir(factoryDir, { providerId: 'factory-real' });
    expect(scan.diagnostics).toEqual([]);
    expect(scan.skills.map((s) => s.name).sort()).toEqual([...FACTORY_SKILL_NAMES].sort());
  });

  // 参数化逐名断言：每个出厂名解析到真实 SKILL.md（文件在场 + 扫描装载面一致）
  it.each(FACTORY_SKILL_NAMES)('出厂名解析——%s 必解析到真实 SKILL.md', async (name) => {
    const factoryDir = resolveFactorySkillsDir();
    expect(existsSync(join(factoryDir, name, 'SKILL.md'))).toBe(true);
    const scan = await scanSkillsDir(factoryDir, { providerId: 'factory-real' });
    const skill = scan.skills.find((s) => s.name === name);
    expect(skill?.filePath).toBe(join(factoryDir, name, 'SKILL.md'));
    expect(skill?.description.length).toBeGreaterThan(0);
  });

  it('user 层同名恒压出厂件——first-wins 优先序真源（注册序即优先序）', async () => {
    const ws = await tmpRoot('ws-factory-override');
    const dataDir = await tmpRoot('data-factory-override');
    const home = await tmpRoot('home-factory-override'); // 隔离假家目录——跨库层不触真实 HOME
    // user 层落一枚与出厂件同名的技能（真出厂名 memory-tools）；factory 用真出厂目录
    await writeSkill(join(dataDir, 'skills'), 'memory-tools', '用户层同名覆盖件');
    const registry = createSkillsRegistry();
    for (const layer of createStandardLayers({ cwd: ws, dataDir, homeDir: home })) {
      registry.registerProvider(layer);
    }
    const report = await registry.refresh();
    // 四件出厂 + user 同名件 → 同名吸收后恰 4（collision 计 1：winner=user 件）
    expect(report.total).toBe(4);
    expect(report.collisions).toBe(1);
    const winner = registry.get('memory-tools');
    expect(winner?.description).toBe('用户层同名覆盖件');
    expect(winner?.filePath).toContain(join(dataDir, 'skills'));
    // 同名唯一面：被压过的出厂件不重复出现（first-wins 吸收形）
    expect(registry.list().filter((s) => s.name === 'memory-tools')).toHaveLength(1);
    // 出厂其余三件不受同名覆盖影响（恒扫描、末位但不被牵连）
    for (const name of ['coding-persona', 'plugins-quickstart', 'goal-unattended']) {
      expect(registry.get(name)?.providerId).toBe('factory');
    }
  });
});
