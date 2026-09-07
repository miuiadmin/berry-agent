/**
 * 声明式子代理解析层（06 §11.6——解析层住 core:skills、机器住 core:subagent）。
 *
 * agents/*.md = frontmatter（name/description/tools/requires/model）+ 正文即
 * 系统提示。发现位置镜像技能位 1-4：project `.agents/agents`（需目录信任）>
 * user `<dataDir>/agents` > 跨库 `~/.agents/agents` 与 `~/.claude/agents` >
 * 插件声明载荷；位 5 CLI/动态不纳入、位 6 无出厂位。层序即信任序，
 * first-wins 同名压制。坏文件 warning 跳过不炸装配（同技能纪律）。
 *
 * 本件只产纯数据 def（SubagentDef——contracts 归位）；yaml 解析复用技能
 * frontmatter 机器（yaml 裸导入白名单不扩——subagent 收 def 零 yaml）。
 */
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { realpathSync } from 'node:fs';
import { basename, join } from 'node:path';
import { homedir } from 'node:os';
import type { SubagentDef } from '../contracts/index.js';
import { canonicalWorkspaceRoot } from '../context/index.js';
import { parseSkillFrontmatter, validateSkillName } from './frontmatter.js';
import { SKILL_DESCRIPTION_MAX, type SkillDiagnostic } from './types.js';

/** 解析失败形态（人读原因——诊断面直接透传，镜像 SkillFrontmatterError） */
export interface AgentDefError {
  readonly error: string;
}

/** 单文件解析产物（def | 错误——判别联合） */
export type ParsedAgentDef = SubagentDef | AgentDefError;

/**
 * 从 agents/*.md 全文解析声明式子代理 def。
 *
 * 处置逐条（06 §11.6 + §11.2 技能纪律镜像）：
 *  - frontmatter 坏形（无开闭 --- 等）→ 拒；
 *  - description 非字符串或空白 → 拒（唯一硬条件——披露段清单行的唯一依据）；
 *  - description 超 1024 → 截断装载（清单行帽同技能律）；
 *  - name 缺席 → 回落文件基名（去 .md）；提供时须与基名一致（身份键纪律：
 *    静态工具名 agent_<name> 与文件名漂移即双名混乱）且过技能名词法
 *    （物化为工具名的词法安全面）——违例拒（name 是注册键不宽容）；
 *  - tools/requires 非字符串数组 → 拒；model 非字符串 → 拒；
 *  - 正文空（trim 后）→ 拒（正文即系统提示——空正文无装载面）；
 *  - 未采用字段（license 等生态超集）→ 静默忽略（生态宽容——CC 形可装载）。
 */
export function parseAgentDef(raw: string, context: { filePath: string }): ParsedAgentDef {
  const parsed = parseSkillFrontmatter(raw);
  if ('error' in parsed) {
    return { error: parsed.error };
  }
  const frontmatter = parsed.frontmatter;

  // description：必填（模型选择依据——声明式工具 description 直传此值）
  const rawDescription = frontmatter['description'];
  if (typeof rawDescription !== 'string' || rawDescription.trim() === '') {
    return { error: 'description 缺席或为空（必填——披露段清单行的唯一依据）' };
  }
  const description =
    rawDescription.length > SKILL_DESCRIPTION_MAX ? rawDescription.slice(0, SKILL_DESCRIPTION_MAX) : rawDescription;

  // name：缺席回落文件基名（去扩展名）；提供须一致 + 技能名词法（工具名安全面）
  const stem = basename(context.filePath).replace(/\.md$/i, '');
  const rawName = frontmatter['name'];
  const name = typeof rawName === 'string' && rawName !== '' ? rawName : stem;
  if (name !== stem) {
    return { error: `name（${name}）与文件基名（${stem}）不一致——agents 文件约定 = 同名文件承载同名子代理` };
  }
  const nameErrors = validateSkillName(name);
  if (nameErrors.length > 0) {
    return { error: nameErrors.join('；') };
  }

  // tools/requires：可选字符串数组（白名单与前置要求正交——语义执法在机器侧）
  const tools = parseStringList(frontmatter['tools'], 'tools');
  if ('error' in tools) return { error: tools.error };
  const requires = parseStringList(frontmatter['requires'], 'requires');
  if ('error' in requires) return { error: requires.error };

  // model：可选字符串（模型覆盖——启动参数直传工厂）
  const rawModel = frontmatter['model'];
  if (rawModel !== undefined && typeof rawModel !== 'string') {
    return { error: 'model 须为字符串（模型覆盖名）' };
  }

  // 正文即系统提示（保留原始缩进——frontmatter 闭合 --- 之后全文）
  if (parsed.body.trim() === '') {
    return { error: '正文空（正文即系统提示——空正文无装载面）' };
  }

  return {
    name,
    description,
    ...(tools.value !== undefined ? { tools: tools.value } : {}),
    ...(requires.value !== undefined ? { requires: requires.value } : {}),
    ...(rawModel !== undefined ? { model: rawModel } : {}),
    systemPrompt: parsed.body,
    filePath: context.filePath,
  };
}

/** 字符串数组字段解析（undefined 放行；非数组/含非字符串 → 拒） */
function parseStringList(value: unknown, field: string): { value?: readonly string[] } | { error: string } {
  if (value === undefined) return {};
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    return { error: `${field} 须为字符串数组` };
  }
  return { value: value as readonly string[] };
}

/** 层扫描产物（镜像 ProviderScan——诊断复用技能诊断形状） */
export interface AgentLayerScan {
  readonly defs: readonly SubagentDef[];
  readonly diagnostics: readonly SkillDiagnostic[];
}

/** 目录层 provider 构造参数（镜像 DirProviderOptions——扁平扫描无递归） */
export interface AgentLayerOptions {
  readonly id: string;
  /** 扫描根（可多条——跨库层两位目录同 provider） */
  readonly roots: readonly string[];
  /** project 层信任锚标记（false = 跳过扫描带诊断——装载不激活） */
  readonly trusted?: boolean;
  /** realpath 去重集注入（跨 provider 共享——缺省独立集合） */
  readonly seenRealPaths?: Set<string>;
}

/** 目录层 provider（标准层与插件声明载荷层共用） */
export interface AgentDefsProvider {
  readonly id: string;
  readonly roots: readonly string[];
  readonly trusted?: boolean;
  scan(): Promise<AgentLayerScan>;
}

/**
 * 扁平目录层 provider 工厂：每根目录直扫 `*.md`（不递归——agents 是平铺
 * 单文件形，非技能目录树形；无 gitignore 机器——树形剪枝纪律不适用平铺面）。
 * trusted=false → 空扫描 + 单诊断（镜像技能层语义：不入清单即零注入面）。
 */
export function createAgentLayerProvider(options: AgentLayerOptions): AgentDefsProvider {
  return {
    id: options.id,
    roots: options.roots,
    ...(options.trusted !== undefined ? { trusted: options.trusted } : {}),
    scan: async (): Promise<AgentLayerScan> => {
      const defs: SubagentDef[] = [];
      const diagnostics: SkillDiagnostic[] = [];
      if (options.trusted === false) {
        return {
          defs,
          diagnostics: [
            {
              type: 'warning',
              message: 'project 子代理目录未获目录信任锚——整层跳过（04 目录信任条：装载不激活）',
              path: options.roots[0],
            },
          ],
        };
      }
      const seen = options.seenRealPaths ?? new Set<string>();
      const seenNames = new Set<string>(); // 同层同名（跨文件声明 name 撞）——后到跳过带诊断
      for (const root of options.roots) {
        if (!existsSync(root)) continue;
        let entries;
        try {
          entries = await readdir(root, { withFileTypes: true });
        } catch {
          continue; // 读失败（权限/竞态消失）——跳过继续
        }
        // 文件名排序——同层装载序确定（readdir 序不保证）
        const files = entries
          .filter((entry) => entry.isFile() && /\.md$/i.test(entry.name))
          .map((entry) => entry.name)
          .sort();
        for (const fileName of files) {
          const filePath = join(root, fileName);
          let realPath: string;
          try {
            realPath = realpathSync(filePath);
          } catch {
            continue; // 断链符号链——跳过
          }
          if (seen.has(realPath)) continue; // 同文件双发现去重（静默——跨层 symlink 别名）
          let raw: string;
          try {
            raw = await readFile(realPath, 'utf8');
          } catch (error) {
            diagnostics.push({
              type: 'warning',
              message: `agents 文件读取失败：${error instanceof Error ? error.message : String(error)}`,
              path: filePath,
            });
            continue;
          }
          seen.add(realPath);
          const parsed = parseAgentDef(raw, { filePath });
          if ('error' in parsed) {
            // 坏文件 warning 跳过不炸装配（06 §11.6——诊断语义同技能坏文件）
            diagnostics.push({ type: 'invalid-metadata', message: parsed.error, path: filePath });
            continue;
          }
          if (seenNames.has(parsed.name)) {
            diagnostics.push({
              type: 'collision',
              message: `同层子代理撞名「${parsed.name}」——后到文件跳过（first-wins）`,
              path: filePath,
            });
            continue;
          }
          seenNames.add(parsed.name);
          defs.push(parsed);
        }
      }
      return { defs, diagnostics };
    },
  };
}

/** 标准层构造参数（镜像 StandardLayersOptions——agents 无 writable 面无出厂位） */
export interface StandardAgentLayersOptions {
  /** 工作目录（project 层根锚——缺省 process.cwd()） */
  readonly cwd?: string;
  /**
   * 数据目录（user 层 `<dataDir>/agents`）。可选（批 19c-1 装载态）：缺席 =
   * 跳过 user 层（:memory: 诊断形态 dataDir null 无用户子代理面——其余层
   * 照常构造，镜像 skills discovery 同律）。
   */
  readonly dataDir?: string;
  /** home 目录注入（跨库层——缺省 os.homedir()） */
  readonly homeDir?: string;
  /** project 层信任锚（缺省 true——DiscoveryGates 面由装配侧持有） */
  readonly trustedProject?: boolean;
  /** 插件声明载荷层（03 §6.3——mount 即注册；信任序低于主人位） */
  readonly pluginLayers?: readonly Omit<AgentLayerOptions, 'seenRealPaths'>[];
  /** realpath 去重集注入（跨层共享——缺省独立集合） */
  readonly seenRealPaths?: Set<string>;
}

/**
 * 标准发现层（06 §11.6 位 1-4 镜像技能位）：project > user > 跨库 > 插件。
 * 位 5 CLI/动态不纳入、位 6 无出厂位（与技能差异两处——无 skill_manage
 * 写面故无 writable 标记、无宿主出厂 agents）。
 */
export function createStandardAgentLayers(options: StandardAgentLayersOptions): AgentDefsProvider[] {
  const home = options.homeDir ?? homedir();
  const seen = options.seenRealPaths ?? new Set<string>();
  return [
    // 位 1：project `.agents/agents`（canonical 工作区根锚——需目录信任）
    createAgentLayerProvider({
      id: 'project',
      roots: [join(canonicalWorkspaceRoot(options.cwd ?? process.cwd()), '.agents', 'agents')],
      trusted: options.trustedProject ?? true,
      seenRealPaths: seen,
    }),
    // 位 2：user `<dataDir>/agents`（无需信任——dataDir 缺席跳位，:memory: 形）
    ...(options.dataDir !== undefined
      ? [createAgentLayerProvider({ id: 'user', roots: [join(options.dataDir, 'agents')], seenRealPaths: seen })]
      : []),
    // 位 3：跨库 `~/.agents/agents` 与 `~/.claude/agents`（生态复用——CC 形可装载）
    createAgentLayerProvider({
      id: 'cross-repo',
      roots: [join(home, '.agents', 'agents'), join(home, '.claude', 'agents')],
      seenRealPaths: seen,
    }),
    // 位 4：插件声明载荷层（信任序低于主人位——first-wins 全序表达）
    ...(options.pluginLayers ?? []).map((layer) => createAgentLayerProvider({ ...layer, seenRealPaths: seen })),
  ];
}

/** 全层合并产物 */
export interface AgentDefsCollection {
  readonly defs: readonly SubagentDef[];
  readonly diagnostics: readonly SkillDiagnostic[];
}

/**
 * 按层序合并（first-wins 同名压制——层序即信任序，project 恒压 user）。
 * 后层同名静默压制（主人位既定，后者诊断只作装载日志不作冲突面——
 * 与同层撞名的 collision 诊断分立）。
 */
export async function collectAgentDefs(providers: readonly AgentDefsProvider[]): Promise<AgentDefsCollection> {
  const defs: SubagentDef[] = [];
  const diagnostics: SkillDiagnostic[] = [];
  const seenNames = new Set<string>();
  for (const provider of providers) {
    const scan = await provider.scan();
    diagnostics.push(...scan.diagnostics);
    for (const def of scan.defs) {
      if (seenNames.has(def.name)) continue; // 跨层同名——先到主人位胜出（first-wins）
      seenNames.add(def.name);
      defs.push(def);
    }
  }
  return { defs, diagnostics };
}
