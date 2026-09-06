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

  it('共享 seenRealPaths——插件层与出厂层同文件只装一次', async () => {
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
    const names: string[] = [];
    for (const layer of layers) names.push(...(await layer.scan()).skills.map((s) => s.name));
    expect(names.filter((n) => n === 'same')).toHaveLength(1); // 插件层与出厂层同根去重
  });
});

describe('resolveFactorySkillsDir 出厂目录定位', () => {
  it('发现模块位置上推两级 = 包根/skills（src 与 dist 双形态同构）', () => {
    expect(resolveFactorySkillsDir(pathToFileURL('/pkg/dist/skills/discovery.js').href)).toBe(join('/pkg', 'skills'));
    expect(resolveFactorySkillsDir(pathToFileURL('/pkg/src/skills/discovery.js').href)).toBe(join('/pkg', 'skills'));
  });
});
