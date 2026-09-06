/**
 * 技能发现层（06 §11.4 发现位置与优先级——六位序列的位 1/2/3/4/6 落码形态；
 * 位 5 CLI/动态注入不纳入 v1）。
 *
 * 发现规则（pi 蓝本同律）：目录含 SKILL.md 即为技能根不再递归；否则递归子目录。
 * 尊重 .gitignore——前缀化锚定判据与检索族（tools/search.ts）/快照遍历三副本
 * 同笔同判（06 §11.4 括注：模式体去尾随目录标记斜杠后含斜杠或带前导 / = 锚定
 * 本层精确匹配；纯 basename 模式前缀化插目录通配前缀（`**`+`/`）保本层与
 * symlink 目录跟随（realpath 去重防环——与 pi 同律；检索族防环不跟随是遍历
 * 面差异：技能面文件量小且 realpath 集合天然断环）。
 *
 * 信任语义（04 目录信任条）：project 层需目录信任锚——trusted=false 时整层跳过
 * 扫描并落诊断（装载不激活的 v1 实现：不入清单即零注入面）；user/跨库/出厂层
 * 无需信任（出厂 = 与官方插件同源分发恒扫描）。
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ignore from 'ignore';
import { canonicalWorkspaceRoot } from '../context/index.js';
import { loadSkillFromText } from './frontmatter.js';
import type { ProviderScan, Skill, SkillDiagnostic, SkillsProvider } from './types.js';

/** gitignore 匹配器类型（ignore 包工厂返回值） */
type IgnoreMatcher = ReturnType<typeof ignore>;

/** 遍历常量剪枝（与检索族同表语义：依赖目录与 git 元数据） */
const PRUNE_DIRS = new Set(['node_modules', '.git']);

/** 平台路径分隔符归一为 /（gitignore 模式语义在 posix 路径上） */
function toPosix(p: string): string {
  return p.split(sep).join('/');
}

/**
 * 单行 gitignore 模式前缀化（06 §11.4 锚定判据——与检索族/快照遍历三副本同笔
 * 同判；实现与 tools/search.ts 逐分支对齐）。注释/空行丢弃；`!` 否定与 `\!`/
 * `\#` 转义保留；纯 basename 模式前缀化插目录通配前缀（`**`+`/`）保深层同配。
 */
function prefixIgnorePattern(line: string, prefix: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('#') && !trimmed.startsWith('\\#')) return null;

  let pattern = line;
  let negated = false;
  if (pattern.startsWith('!')) {
    negated = true;
    pattern = pattern.slice(1);
  } else if (pattern.startsWith('\\!')) {
    pattern = pattern.slice(1);
  }
  // 前导 / = 显式锚定标记（先记下再去掉；锚定形相对本目录精确匹配）
  const rooted = pattern.startsWith('/');
  if (rooted) pattern = pattern.slice(1);
  if (!prefix) {
    // 根 .gitignore 锚定形保留前导 /（git 语义：前导分隔符 = 锚定本层——剥掉
    // 透传会把锚定降级成任意层匹配；检索族同笔同判同修）
    const passed = rooted ? `/${pattern}` : pattern;
    return negated ? `!${passed}` : passed;
  }
  const body = pattern.endsWith('/') ? pattern.slice(0, -1) : pattern;
  const anchored = rooted || body.includes('/');
  const prefixed = anchored ? `${prefix}${pattern}` : `${prefix}**/${pattern}`;
  return negated ? `!${prefixed}` : prefixed;
}

/** 读 dir 下 .gitignore 并按所在目录前缀化挂上匹配器（嵌套规则只作用本子树） */
async function addIgnoreRules(matcher: IgnoreMatcher, dir: string, rootDir: string): Promise<void> {
  let content: string;
  try {
    content = await readFile(join(dir, '.gitignore'), 'utf8');
  } catch {
    return; // 无 .gitignore 或读失败——本目录无额外规则
  }
  const prefix = toPosix(relative(rootDir, dir));
  const prefixed = prefix ? `${prefix}/` : '';
  const patterns = content
    .split(/\r?\n/)
    .map((line) => prefixIgnorePattern(line, prefixed))
    .filter((line): line is string => line !== null);
  if (patterns.length > 0) matcher.add(patterns);
}

/** 目录扫描内部产物（skills 顺序确定：目录序 × 名称字典序） */
interface DirScan {
  readonly skills: Skill[];
  readonly diagnostics: SkillDiagnostic[];
}

/**
 * 扫描一个技能层根目录（06 §11.4「目录含 SKILL.md 即为技能根不再递归」）。
 *
 * 缺席目录 = 空结果不诊断（跨库目录 ~/.claude/skills 等常态缺席）。
 * realpath 去重集由调用方传入（跨根共享——同文件经符号链双发现的去重锚）。
 */
export async function scanSkillsDir(
  dir: string,
  options: { providerId: string; seenRealPaths?: Set<string> } = { providerId: 'unknown' },
): Promise<DirScan> {
  const seen = options.seenRealPaths ?? new Set<string>();
  const result = await scanDirInternal(resolve(dir), resolve(dir), options.providerId, ignore(), seen);
  return result;
}

/** 实际递归（每层目录同一规则：本目录含 SKILL.md 即技能根不再下钻；否则递归子目录） */
async function scanDirInternal(
  dir: string,
  root: string,
  providerId: string,
  matcher: IgnoreMatcher,
  seen: Set<string>,
): Promise<DirScan> {
  const skills: Skill[] = [];
  const diagnostics: SkillDiagnostic[] = [];
  if (!existsSync(dir)) return { skills, diagnostics };

  await addIgnoreRules(matcher, dir, root);
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return { skills, diagnostics }; // 读失败（权限/竞态消失）——跳过继续
  }

  // 第一遍：本目录含 SKILL.md 即技能根（不递归）——发现即返回
  const skillMd = entries.find((e) => e.name === 'SKILL.md');
  if (skillMd !== undefined) {
    const filePath = join(dir, 'SKILL.md');
    if (!ignoredPath(matcher, root, filePath)) {
      const loaded = await loadSkillFile(filePath, providerId, seen);
      skills.push(...loaded.skills);
      diagnostics.push(...loaded.diagnostics);
    }
    return { skills, diagnostics };
  }

  // 第二遍：递归子目录（点目录与依赖目录剪枝；符号链目录跟随——realpath 断环）
  for (const entry of entries) {
    if (entry.name.startsWith('.') || PRUNE_DIRS.has(entry.name)) continue;
    const fullPath = join(dir, entry.name);
    let isDirectory = entry.isDirectory();
    if (entry.isSymbolicLink()) {
      try {
        isDirectory = (await stat(fullPath)).isDirectory();
      } catch {
        continue; // 断链——跳过
      }
    }
    if (!isDirectory) continue; // 技能面只认 <名>/SKILL.md 目录形（散 .md 非技能）
    if (ignoredPath(matcher, root, fullPath, true)) continue;
    const sub = await scanDirInternal(fullPath, root, providerId, matcher, seen);
    skills.push(...sub.skills);
    diagnostics.push(...sub.diagnostics);
  }
  return { skills, diagnostics };
}

/** 路径 gitignore 判定（目录双测带/不带尾斜杠——兼容 `dir/` 与 `dir` 两种写法） */
function ignoredPath(matcher: IgnoreMatcher, root: string, fullPath: string, isDir = false): boolean {
  const rel = toPosix(relative(root, fullPath));
  if (rel === '') return false; // 根自身不判
  return isDir ? matcher.ignores(rel) || matcher.ignores(`${rel}/`) : matcher.ignores(rel);
}

/** 单 SKILL.md 装载（读失败/realpath 已见 → 跳过；校验诊断透传） */
async function loadSkillFile(filePath: string, providerId: string, seen: Set<string>): Promise<DirScan> {
  const diagnostics: SkillDiagnostic[] = [];
  let realPath: string;
  try {
    realPath = realpathSync(filePath);
  } catch {
    return { skills: [], diagnostics }; // 断链符号链——跳过
  }
  if (seen.has(realPath)) return { skills: [], diagnostics }; // 同文件双发现去重（静默）
  let raw: string;
  try {
    raw = await readFile(realPath, 'utf8');
  } catch (error) {
    diagnostics.push({
      type: 'warning',
      message: `SKILL.md 读取失败：${error instanceof Error ? error.message : String(error)}`,
      path: filePath,
    });
    return { skills: [], diagnostics };
  }
  seen.add(realPath);
  const loaded = loadSkillFromText(raw, { filePath, providerId });
  return { skills: loaded.skill !== undefined ? [loaded.skill] : [], diagnostics: [...loaded.diagnostics] };
}

/** 目录形 provider 构造参数 */
export interface DirProviderOptions {
  readonly id: string;
  /** 扫描根（可多条——跨库层两位目录同 provider） */
  readonly roots: readonly string[];
  /** v1 仅 project 层 true（skill_manage patch 域） */
  readonly writable?: boolean;
  /** project 层信任锚标记（false = 跳过扫描带诊断） */
  readonly trusted?: boolean;
  /** realpath 去重集注入（跨 provider 共享——缺省独立集合） */
  readonly seenRealPaths?: Set<string>;
}

/**
 * 目录扫描 provider 工厂（标准层与插件声明载荷层共用——03 §6.1 mount 即注册）。
 *
 * trusted=false → 空扫描 + 单诊断（装载不激活：不入清单即零注入面——信任授予
 * 是用户动作，模型不可自授）。
 */
export function createDirProvider(options: DirProviderOptions): SkillsProvider {
  return {
    id: options.id,
    roots: options.roots,
    ...(options.writable !== undefined ? { writable: options.writable } : {}),
    ...(options.trusted !== undefined ? { trusted: options.trusted } : {}),
    scan: async (): Promise<ProviderScan> => {
      if (options.trusted === false) {
        return {
          skills: [],
          diagnostics: [
            {
              type: 'warning',
              message: 'project 技能目录未获目录信任锚——整层跳过（04 目录信任条：装载不激活）',
              path: options.roots[0],
            },
          ],
        };
      }
      const skills: Skill[] = [];
      const diagnostics: SkillDiagnostic[] = [];
      const seen = options.seenRealPaths ?? new Set<string>();
      for (const root of options.roots) {
        const scanned = await scanSkillsDir(root, { providerId: options.id, seenRealPaths: seen });
        skills.push(...scanned.skills);
        diagnostics.push(...scanned.diagnostics);
      }
      return { skills, diagnostics };
    },
  };
}

/**
 * 出厂技能目录定位（06 §11.4 位 6：`<包根>/skills/`——包根 = 发现模块位置上推
 * 两级；源码 src/skills/* 与产物 dist/skills/* 双形态同构，上推两级皆包根）。
 */
export function resolveFactorySkillsDir(moduleUrl: string = import.meta.url): string {
  // dist/skills/discovery.js → dirname 两次 = 包根（src 形同理）
  const moduleDir = dirname(fileURLToPath(moduleUrl));
  return resolve(moduleDir, '..', '..', 'skills');
}

/** 标准层装配参数（批 12 装载面消费——06 §11.4 六位序列的宿主侧全序） */
export interface StandardLayersOptions {
  /** 工作目录（缺省 process.cwd——project 层锚 canonical 工作区根） */
  readonly cwd?: string;
  /** 数据目录（user 层 `<dataDir>/skills`——BERRY_AGENT_DATA_DIR 语义由装配解析注入） */
  readonly dataDir: string;
  /** 家目录（跨库层两位目录锚；缺省 os.homedir） */
  readonly homeDir?: string;
  /** 插件声明载荷层（03 §6.1 berryAgent.skills——host 装载器 mount 即注册） */
  readonly pluginLayers?: readonly DirProviderOptions[];
  /** 出厂目录覆盖（测试注入位；缺省 resolveFactorySkillsDir） */
  readonly factoryDir?: string;
  /** project 层目录信任（缺省 true——装配按信任锚集合判定注入） */
  readonly trustedProject?: boolean;
  /** 跨 provider 共享的 realpath 去重集（缺省独立集合） */
  readonly seenRealPaths?: Set<string>;
}

/**
 * 构造六位序列标准层（注册序即优先序——project > user > 跨库 > 插件 > 出厂；
 * provider 注册序即优先序 06 §11.3 护栏②，同名 first-wins 由扫描序表达）。
 */
export function createStandardLayers(options: StandardLayersOptions): SkillsProvider[] {
  const home = options.homeDir ?? homedir();
  const seen = options.seenRealPaths ?? new Set<string>();
  const shared = { seenRealPaths: seen };
  const layers: SkillsProvider[] = [
    // 位 1：project `.agents/skills`（canonical 工作区根锚——与 memory owner_key/
    // project 域键同源一处实现；需目录信任、可改写）
    createDirProvider({
      id: 'project',
      roots: [join(canonicalWorkspaceRoot(options.cwd ?? process.cwd()), '.agents', 'skills')],
      writable: true,
      trusted: options.trustedProject ?? true,
      ...shared,
    }),
    // 位 2：user `<dataDir>/skills`（无需信任）
    createDirProvider({ id: 'user', roots: [join(options.dataDir, 'skills')], ...shared }),
    // 位 3：跨库 `~/.agents/skills` 与 `~/.claude/skills`（agentskills.io 生态复用）
    createDirProvider({
      id: 'cross-repo',
      roots: [join(home, '.agents', 'skills'), join(home, '.claude', 'skills')],
      ...shared,
    }),
    // 位 4：插件声明载荷层（信任序低于主人位——first-wins 全序表达）
    ...(options.pluginLayers ?? []).map((layer) =>
      createDirProvider({
        ...layer,
        seenRealPaths: seen,
      }),
    ),
    // 位 6：宿主出厂 `<包根>/skills/`（恒扫描、末位——用户/project 同名恒压出厂件）
    createDirProvider({
      id: 'factory',
      roots: [options.factoryDir ?? resolveFactorySkillsDir()],
      ...shared,
    }),
  ];
  return layers;
}
