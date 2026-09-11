/**
 * host/manifest — 插件清单契约与拒绝式形状校验（03 篇 §1.2/§1.3/§5.3）。
 *
 * 契约先行笔（批 12a）：形状类型 + 校验纯函数零副作用——jiti 装载、虚拟键
 * 注入、时钟护栏等装载器机制归批 12d 实装笔消费本面。校验一律**拒绝式**
 * （未知键拒载、坏形当场红——拼写错误不留静默通道），失败面统一 tagged
 * union 不抛（调用方——装机腿/boot 合成腿——决定 fail-loud 还是行级隔离）。
 *
 * 复用件：清单 api 块形状与版本串判据单源在 contracts（ApiBlock /
 * isValidApiVersion——§8.4 装载门同判据，不散拷）。
 */
import { join } from 'node:path';

import type { ApiBlock } from '../contracts/index.js';
import { parseConfigSchemaFields, type ConfigField } from './config-schema.js';
import { isValidApiVersion } from '../contracts/index.js';
// internal 桶机制符号深导（opens 授予位值域单源——02 §4.3 #2 深挖面册纪律）
import { DOORS_SEGMENT_V1_DOMAIN, USER_GRANTABLE_CAPABILITIES } from '../contracts/api.js';

/* ---------------- 清单形状（package.json `berryAgent` 字段） ---------------- */

/**
 * 插件清单——`berryAgent` 块解析产物（03 §1.2 单一形状，禁双载体）。
 * 静态声明全在此（id/label/entry/grants/config/api/skills 每键恰一真源）；
 * 运行时声明（inject/optionalInject/events）归入口模块 named exports
 * （装载器求值——批 12d）。
 */
export interface PluginManifest {
  /** 插件 id（缺省 = package.json name；词法基元——数据域目录名/域前缀/账本键） */
  readonly id: string;
  /** 展示名（缺省 = id） */
  readonly label: string;
  /** 包版本（package.json version；git 源可缺席） */
  readonly version?: string;
  /** 入口文件（相对包根；缺席时走入口解析序——见 entryPlan） */
  readonly entry?: string;
  /** grants 申请面（§4 单维 writableRoots；深校验随装载器批——本笔浅校验形状） */
  readonly grants?: Readonly<Record<string, unknown>>;
  /** 宿主侧默认配置值（启用行 config 缺席时的整值回落——schema/值分键后值单源；secret 型键明文值拒载） */
  readonly config?: unknown;
  /** 配置字段声明面（字段描述数组——装载期字段级校验 + 表单腿渲染双消费源；缺席 = 行为零变化） */
  readonly configSchema?: readonly ConfigField[];
  /** API 治理块（§8.4 装载门消费；形状校验在本笔——单源判据 contracts） */
  readonly api?: ApiBlock;
  /** 技能目录清单（§6；非空即在场的「声明载荷」之一——纯声明包判定输入） */
  readonly skills?: readonly string[];
  /**
   * 声明式子代理目录清单（§6.3——06 §11.6 位 4；与 skills 同形：相对包根
   * 目录路径数组）。生态启动批 eco-1 键收下：装载收集随行（agentDirs）、
   * 物化消费腿挂账 core:subagent 消费批（立题档 20260911 裁决点 C 降档）。
   */
  readonly agents?: readonly string[];
  /** 入口解析序判定产物（§1.2 三步定死） */
  readonly entryPlan: PluginEntryPlan;
}

/**
 * 入口解析序三态（03 §1.2——entry 键缺席时的判定序）：
 * ① entry 在场 → entry-file；② entry 缺席且声明载荷在场 = 纯声明包（零码装载，
 * 包主入口不执行）；③ 缺省 → 执行包主入口 default export。
 */
export type PluginEntryPlan =
  | { readonly kind: 'entry-file'; readonly entry: string }
  | { readonly kind: 'declared-payload' }
  | { readonly kind: 'default-export' };

/**
 * 清单键目录（API 治理真相源⑤——03 §8.2「清单键与类型」；抽取器 jiti 导入
 * 收割进 surface.json 的 manifest-keys 域）。校验闭集自本目录派生——键表增删
 * 两路（目录 / parseManifest 未知键执法）同笔共变，结构性不可漂移。tier 全
 * stable：清单键是插件作者依赖面（§1.2 拍板定形；§8.3「现役全 stable」同律）。
 */
export const MANIFEST_KEY_CATALOG: readonly {
  readonly key: string;
  readonly tier: 'stable';
  readonly desc: string;
}[] = [
  { key: 'id', tier: 'stable', desc: '插件 id；缺省取 package.json name，不合字符集须显式声明（无隐式映射变换）' },
  { key: 'label', tier: 'stable', desc: '展示名；缺省取 id' },
  { key: 'entry', tier: 'stable', desc: '入口文件（相对包根）；缺席走入口解析序三步' },
  { key: 'grants', tier: 'stable', desc: '授权申请面；单维 writableRoots 字符串数组' },
  {
    key: 'config',
    tier: 'stable',
    desc: '宿主侧默认配置值（启用行 config 缺席时作 apply 的 config 实参；形状声明归 configSchema——2026-09-11 交互动词族批 schema/值分键）',
  },
  {
    key: 'configSchema',
    tier: 'stable',
    desc: '配置字段声明面（字段描述数组——字段级校验与 /plugins config 表单渲染双消费源）',
  },
  { key: 'api', tier: 'stable', desc: 'API 治理块（minApiVersion/targetApiVersion/experimental）' },
  { key: 'skills', tier: 'stable', desc: '技能目录清单；非空即在场的「声明载荷」之一（纯声明包零码装载）' },
  {
    key: 'agents',
    tier: 'stable',
    desc: '声明式子代理目录清单（06 §11.6 位 4；与 skills 同形——mount 即收集、物化消费腿挂 core:subagent 消费批）',
  },
];

/** 清单块已知键闭集（未知键拒载——拒绝式而非忽略式；自目录派生单源） */
const MANIFEST_KEYS = new Set(MANIFEST_KEY_CATALOG.map((k) => k.key));

/** 插件 id 字符集：小写字母/数字/连字符，首字符非连字符（03 §1.2） */
const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

/** 官方前缀（core: 为官方插件保留——冒号仅许官方前缀位） */
const CORE_PREFIX = 'core:';

/**
 * id 字符集校验（03 §1.2 前缀豁免句）。
 *
 * - 用户插件（official=false）：整串过字符集且**不含冒号**——起头 `core:` 或
 *   含 `:` 一律拒（官方前缀保留 + 冒号仅许官方前缀位）；
 * - 官方引用形（official=true，§1.4——core: 形状与磁盘插件同轨校验）：id 形如
 *   `core:<name>` 时校验对象 = `<name>` 段过同一字符集。
 */
export function checkPluginId(id: string, opts: { official: boolean }): boolean {
  if (opts.official) {
    if (!id.startsWith(CORE_PREFIX)) return PLUGIN_ID_RE.test(id) && !id.includes(':');
    const name = id.slice(CORE_PREFIX.length);
    return name.length > 0 && PLUGIN_ID_RE.test(name);
  }
  if (id.includes(':')) return false;
  return PLUGIN_ID_RE.test(id);
}

/**
 * 校验失败结果（message 分流）。形状违例码 PLUGIN_SHAPE_INVALID；secret 明文
 * 拒码 PLUGIN_CONFIG_INVALID（03 §1.2「双源同拒」清单侧半边——install 时刻
 * 即拒，码与装载器行 config 半边同码同律）。
 */
export interface ManifestInvalid {
  readonly ok: false;
  readonly code: 'PLUGIN_SHAPE_INVALID' | 'PLUGIN_CONFIG_INVALID';
  readonly message: string;
}

/** 校验通过结果 */
export interface ManifestValid {
  readonly ok: true;
  readonly manifest: PluginManifest;
}

export type ManifestParseResult = ManifestValid | ManifestInvalid;

/**
 * 解析并校验插件清单（纯函数）。
 *
 * 输入 = package.json 解析产物（JSON 对象——宿主侧 json/yaml 载体差异由调用方
 * 抹平）；`official` 旗区分用户磁盘插件与 core: 官方引用形（§1.4 对象直调形态
 * 的清单面也经本校验——同轨纪律）。失败一律 `PLUGIN_SHAPE_INVALID`，message
 * 自带指路（缺省 id 不合字符集时指路清单显式声明 `berryAgent.id`——无隐式
 * 映射变换，§1.2 拍板题 10）。
 */
export function parseManifest(pkg: unknown, opts: { official?: boolean } = {}): ManifestParseResult {
  const official = opts.official === true;
  if (typeof pkg !== 'object' || pkg === null || Array.isArray(pkg)) {
    return shapeFail('package.json 顶层须为对象');
  }
  const record = pkg as Record<string, unknown>;
  const name = record['name'];
  if (typeof name !== 'string' || name.length === 0) {
    return shapeFail('package.json name 缺席或非非空字符串——插件包身份不可判定');
  }
  const block = record['berryAgent'];
  if (block === undefined) {
    // berryAgent 块缺席的包不是插件——install 拒绝（03 §1.2）
    return shapeFail(`包 ${name} 无 berryAgent 字段——不是插件包（清单载体 = package.json 加字段，禁双载体）`);
  }
  if (typeof block !== 'object' || block === null || Array.isArray(block)) {
    return shapeFail(`berryAgent 块须为对象（包 ${name}）`);
  }
  const manifest = block as Record<string, unknown>;

  // 未知键拒载——拒绝式而非忽略式（拼写错误当场红）
  for (const key of Object.keys(manifest)) {
    if (!MANIFEST_KEYS.has(key)) {
      return shapeFail(`berryAgent 未知键 "${key}"（包 ${name}）——已知键闭集：${[...MANIFEST_KEYS].join('/')}`);
    }
  }

  // id：在场须字符串；缺省 = name；不合字符集即拒（缺省不合时指路显式声明）
  let id: string;
  if (manifest['id'] !== undefined) {
    if (typeof manifest['id'] !== 'string' || manifest['id'].length === 0) {
      return shapeFail(`berryAgent.id 须为非空字符串（包 ${name}）`);
    }
    id = manifest['id'];
  } else {
    id = name;
  }
  if (!checkPluginId(id, { official })) {
    return shapeFail(
      manifest['id'] === undefined
        ? `缺省 id（= package.json name "${name}"）不合插件 id 字符集${official ? '' : '（含冒号或 core: 前缀保留）'}——在清单 berryAgent.id 显式声明合法 id（小写字母/数字/连字符，首字符非连字符；无隐式映射变换）`
        : `berryAgent.id "${id}" 不合插件 id 字符集（小写字母/数字/连字符，首字符非连字符${official ? '；core: 前缀后段同判据' : '；冒号仅许官方前缀位——core: 为官方插件保留'}）`,
    );
  }

  // label：缺省 = id；须字符串
  let label = id;
  if (manifest['label'] !== undefined) {
    if (typeof manifest['label'] !== 'string' || manifest['label'].length === 0) {
      return shapeFail(`berryAgent.label 须为非空字符串（插件 ${id}）`);
    }
    label = manifest['label'];
  }

  // version（package.json 顶层透传——git 源可缺席）
  const version = record['version'];
  if (version !== undefined && typeof version !== 'string') {
    return shapeFail(`package.json version 须为字符串（插件 ${id}）`);
  }

  // entry：须字符串
  if (manifest['entry'] !== undefined && (typeof manifest['entry'] !== 'string' || manifest['entry'].length === 0)) {
    return shapeFail(`berryAgent.entry 须为非空字符串（插件 ${id}）`);
  }

  // grants：须对象（深校验 writableRoots 形随装载器批——本笔浅校验）
  if (manifest['grants'] !== undefined) {
    const grants = manifest['grants'];
    if (typeof grants !== 'object' || grants === null || Array.isArray(grants)) {
      return shapeFail(`berryAgent.grants 须为对象（插件 ${id}——申请面 { writableRoots: string[] }）`);
    }
    const roots = (grants as Record<string, unknown>)['writableRoots'];
    if (roots !== undefined && (!Array.isArray(roots) || roots.some((r) => typeof r !== 'string'))) {
      return shapeFail(`berryAgent.grants.writableRoots 须为字符串数组（插件 ${id}）`);
    }
  }

  // config：须对象（宿主侧默认配置值——schema/值分键后值单源；secret 明文拒在 configSchema 解析后交叉判）
  if (manifest['config'] !== undefined) {
    const config = manifest['config'];
    if (typeof config !== 'object' || config === null || Array.isArray(config)) {
      return shapeFail(`berryAgent.config 须为对象（插件 ${id}——宿主侧默认配置值）`);
    }
  }

  // configSchema：字段描述数组深校验（ix-3——03 §1.2 configSchema 条款）+ 清单侧 secret 明文拒
  let configSchema: readonly ConfigField[] | undefined;
  if (manifest['configSchema'] !== undefined) {
    const parsed = parseConfigSchemaFields(manifest['configSchema'], { pluginId: id });
    if (!parsed.ok) {
      return shapeFail(parsed.message);
    }
    configSchema = parsed.fields;
    // secret 明文拒（清单侧半边——宿主默认值位携 secret 键明文值拒；行 config 半边归装载器）
    if (manifest['config'] !== undefined) {
      const defaults = manifest['config'] as Record<string, unknown>;
      const leaked = configSchema.filter((f) => f.type === 'secret' && f.key in defaults).map((f) => f.key);
      if (leaked.length > 0) {
        return configFail(
          `清单 config 键携 secret 型键明文值（插件 ${id}：${leaked.join('、')}）——从 package.json 删该键、走表单/凭证盒（package.json 随 npm 分发明文更烈）`,
        );
      }
    }
  }

  // api 块：形状 + 版本串判据（单源 contracts——isValidApiVersion 同判据）
  let api: ApiBlock | undefined;
  if (manifest['api'] !== undefined) {
    const rawApi = manifest['api'];
    if (typeof rawApi !== 'object' || rawApi === null || Array.isArray(rawApi)) {
      return shapeFail(`berryAgent.api 须为对象（插件 ${id}）`);
    }
    const apiRecord = rawApi as Record<string, unknown>;
    for (const key of Object.keys(apiRecord)) {
      if (key !== 'minApiVersion' && key !== 'targetApiVersion' && key !== 'experimental') {
        return shapeFail(
          `berryAgent.api 未知键 "${key}"（插件 ${id}）——闭集：minApiVersion/targetApiVersion/experimental`,
        );
      }
    }
    if (typeof apiRecord['minApiVersion'] !== 'string' || !isValidApiVersion(apiRecord['minApiVersion'])) {
      return shapeFail(
        `berryAgent.api.minApiVersion 缺席或坏形（插件 ${id}——应为 MAJOR.MINOR 整数点分两段，如 "1.0"）`,
      );
    }
    let targetApiVersion: string | undefined;
    if (apiRecord['targetApiVersion'] !== undefined) {
      if (typeof apiRecord['targetApiVersion'] !== 'string' || !isValidApiVersion(apiRecord['targetApiVersion'])) {
        return shapeFail(`berryAgent.api.targetApiVersion 坏形（插件 ${id}——应为 MAJOR.MINOR 整数点分两段）`);
      }
      targetApiVersion = apiRecord['targetApiVersion'];
      if (versionPairLt(targetApiVersion, apiRecord['minApiVersion'] as string)) {
        return shapeFail(`berryAgent.api targetApiVersion < minApiVersion（插件 ${id}——行为锚不得低于硬地板）`);
      }
    }
    let experimental: readonly string[] | undefined;
    if (apiRecord['experimental'] !== undefined) {
      if (
        !Array.isArray(apiRecord['experimental']) ||
        apiRecord['experimental'].some((k) => typeof k !== 'string' || k.length === 0)
      ) {
        return shapeFail(`berryAgent.api.experimental 须为非空字符串数组（插件 ${id}）`);
      }
      experimental = apiRecord['experimental'] as readonly string[];
    }
    api = { minApiVersion: apiRecord['minApiVersion'] as string, targetApiVersion, experimental };
  }

  // skills：须字符串数组（非空数组即在场的「声明载荷」之一）
  let skills: readonly string[] | undefined;
  if (manifest['skills'] !== undefined) {
    if (!Array.isArray(manifest['skills']) || manifest['skills'].some((s) => typeof s !== 'string' || s.length === 0)) {
      return shapeFail(`berryAgent.skills 须为非空字符串数组（插件 ${id}——技能目录清单）`);
    }
    skills = manifest['skills'] as readonly string[];
  }

  // agents：声明式子代理目录清单（§6.3——与 skills 同形同判据；生态启动批
  // eco-1 键收下：entryPlan 判定同认「声明载荷」，装载收集在 loader）
  let agents: readonly string[] | undefined;
  if (manifest['agents'] !== undefined) {
    if (!Array.isArray(manifest['agents']) || manifest['agents'].some((s) => typeof s !== 'string' || s.length === 0)) {
      return shapeFail(`berryAgent.agents 须为非空字符串数组（插件 ${id}——声明式子代理目录清单）`);
    }
    agents = manifest['agents'] as readonly string[];
  }

  // 入口解析序三步定死（03 §1.2——声明载荷 = skills/agents 任一非空即第②步）
  const entry = manifest['entry'] as string | undefined;
  const declaredPayload = (skills !== undefined && skills.length > 0) || (agents !== undefined && agents.length > 0);
  const entryPlan: PluginEntryPlan =
    entry !== undefined
      ? { kind: 'entry-file', entry }
      : declaredPayload
        ? { kind: 'declared-payload' }
        : { kind: 'default-export' };

  return {
    ok: true,
    manifest: {
      id,
      label,
      version,
      entry,
      grants: manifest['grants'] as PluginManifest['grants'],
      config: manifest['config'],
      configSchema,
      api,
      skills,
      agents,
      entryPlan,
    },
  };
}

/** 形状失败速记（同码分流——install 拒绝与形状违例共用 PLUGIN_SHAPE_INVALID） */
function shapeFail(message: string): ManifestInvalid {
  return { ok: false, code: 'PLUGIN_SHAPE_INVALID', message };
}

/** 值违例失败（secret 明文拒专用——PLUGIN_CONFIG_INVALID 面） */
function configFail(message: string): ManifestInvalid {
  return { ok: false, code: 'PLUGIN_CONFIG_INVALID', message };
}

/** [major, minor] 数值比较：a < b（判据调用方保证两串已过格式校验） */
function versionPairLt(a: string, b: string): boolean {
  const [amaj, amin] = a.split('.').map(Number) as [number, number];
  const [bmaj, bmin] = b.split('.').map(Number) as [number, number];
  return amaj !== bmaj ? amaj < bmaj : amin < bmin;
}

/* ---------------- 启用清单行（enabled.yaml——03 §5.3 单层 overlay） ---------------- */

/**
 * 启用清单文件路径（数据目录下单文件——boot 读侧与 fire 复检活体读侧共用
 * 单源；C 批 C-3：plugin-boot 与 triggers 活体开门读取都经本函数取路径）。
 */
export function enabledYamlPath(dataDir: string): string {
  return join(dataDir, 'enabled.yaml');
}

/**
 * 启用行（03 §5.3 行 schema 定形 + 批 U1 增位）：`{ id, config?, disabled?,
 * opens? }`——无作用域键、无 pkg 引用形、无系统/用户分区（单层）。
 */
export interface EnabledRow {
  readonly id: string;
  /** 行配置（整值替换非合并——用户行覆盖 core: 同名行的字段级后写胜出律归装配层） */
  readonly config?: unknown;
  /** 禁用旗标（toggle 翻转位——行在场但禁用即不装载、注册面零开） */
  readonly disabled?: boolean;
  /**
   * 高危面开门授予位（03 §4.6 批 U1 增位）：值域 = USER_GRANTABLE_CAPABILITIES
   * 名单单源（行校验拒绝式执法）；缺席 = 全默认关；撤位 + 重装载即收回。
   * 「用户授予」载体的第一形态——grants 三方交集授予维的执法数据源。
   */
  readonly opens?: readonly string[];
}

/**
 * 启用清单文档顶层形状（本契约笔钉位裁量：`{ plugins: [行...], doors?: [...] }`
 * ——03 §5.3 钉行 schema、顶层容器形未明文，此处定形随装载器批冷读核对。
 * `doors` 段系开门制扩展批（2026-09-09）增位——模型道高危面开门授予位，
 * 03 §4.6 双源并集律第二源）
 */
export interface EnabledDoc {
  readonly plugins: readonly EnabledRow[];
  /**
   * 进程级开门授予段（顶层——与行内 opens 分立成段：行 opens 授予跟插件 id
   * 走、doors 段授予跟进程走〔模型道 caller 无插件 id 锚〕）。值域 v1 =
   * DOORS_SEGMENT_V1_DOMAIN 两门枚举（射程即值域）；缺席 = 空集。
   */
  readonly doors?: readonly string[];
}

/** 行校验失败——码固定 PLUGIN_ROW_INVALID（拒绝式） */
export interface EnabledRowsInvalid {
  readonly ok: false;
  readonly code: 'PLUGIN_ROW_INVALID';
  readonly message: string;
}

export type EnabledRowsResult =
  { readonly ok: true; readonly rows: readonly EnabledRow[]; readonly doors: readonly string[] } | EnabledRowsInvalid;

/** 行 schema 已知键闭集 */
const ROW_KEYS = new Set(['id', 'config', 'disabled', 'opens']);

/** 顶层文档已知键闭集（plugins + doors——未知顶层键拒绝式，与行键同律） */
const DOC_KEYS = new Set(['plugins', 'doors']);

/**
 * 校验启用清单行集（纯函数——输入 = yaml.load 产物，载体解析在装配层）。
 *
 * 逐行拒绝式：未知键 / id 缺席或坏形 / disabled 非布尔 / config 非对象 /
 * opens 坏形或值域外 / core: 行带 opens 即拒，message 点名行序与插件 id。
 * **同 id 多行即拒**（§5.3「单行 per id——行 schema 无多行载体」；uninstall
 * 段①防线同判据）。用户行 id 不校验 core: 保留——用户行覆盖 core: 同名行
 * 是合法形态（字段级后写胜出），core: 行自身不进用户文件（内置全启）；
 * 覆盖合法性由装配层合成时裁决。
 *
 * 顶层两查（开门制扩展批 2026-09-09 增）：未知顶层键拒（闭集 plugins/doors
 * ——无闭集则 `door:` 之类的段名手误将被静默忽略 = 静默不授予，拒绝式不留
 * 静默通道）；`doors` 段坏形（非数组/空串/值域外）拒——值域 v1 =
 * DOORS_SEGMENT_V1_DOMAIN 两门枚举（射程即值域，§8.2 名单系上界；六枚全宽
 * 将致「清单呈现开、门检实效关」三读分叉），PLUGIN_ROW_INVALID 同门。
 */
export function parseEnabledRows(doc: unknown): EnabledRowsResult {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    return rowFail('启用清单顶层须为对象 { plugins: [行...], doors?: [...] }');
  }
  const record = doc as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!DOC_KEYS.has(key)) {
      return rowFail(`启用清单顶层未知键 "${key}"——已知键闭集：plugins/doors`);
    }
  }
  const plugins = record['plugins'];
  if (!Array.isArray(plugins)) {
    return rowFail('启用清单 plugins 须为数组（行 schema：{ id, config?, disabled?, opens? }）');
  }
  // doors 段三查（03 §5.3 开门制扩展批增段——拒绝式不留静默通道）
  let doors: readonly string[] | undefined;
  if (record['doors'] !== undefined) {
    const rawDoors = record['doors'];
    if (!Array.isArray(rawDoors) || rawDoors.some((d) => typeof d !== 'string' || d.length === 0)) {
      return rowFail('启用清单顶层 doors 须为非空字符串数组（模型道高危面开门授予段——03 §4.6 双源并集律第二源）');
    }
    const values = rawDoors as readonly string[];
    const illegal = values.find((d) => !DOORS_SEGMENT_V1_DOMAIN.includes(d));
    if (illegal !== undefined) {
      return rowFail(
        `启用清单顶层 doors 含非法能力位 "${illegal}"——值域 v1 = 两门枚举（现役：${DOORS_SEGMENT_V1_DOMAIN.join('、')}；§8.2 高危面名单系上界，扩枚随后续模型道高危面立题放宽）`,
      );
    }
    doors = values;
  }
  const rows: EnabledRow[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < plugins.length; i++) {
    const row = plugins[i];
    if (typeof row !== 'object' || row === null || Array.isArray(row)) {
      return rowFail(`第 ${i + 1} 行须为对象（行 schema：{ id, config?, disabled?, opens? }）`);
    }
    const record = row as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (!ROW_KEYS.has(key)) {
        return rowFail(`第 ${i + 1} 行未知键 "${key}"——已知键闭集：id/config/disabled/opens`);
      }
    }
    if (typeof record['id'] !== 'string' || record['id'].length === 0) {
      return rowFail(`第 ${i + 1} 行 id 缺席或非非空字符串——id 即装机账本键`);
    }
    const id = record['id'];
    // 用户行 id 过基础字符集（含 core: 前缀——覆盖官方行合法；校验 = 官方式前缀豁免）
    if (!checkPluginId(id, { official: true })) {
      return rowFail(`第 ${i + 1} 行 id "${id}" 坏形（小写字母/数字/连字符；官方前缀 core:<name> 后段同判据）`);
    }
    if (seen.has(id)) {
      return rowFail(`插件 ${id} 多行——单行 per id（行 schema 无多行载体）`);
    }
    seen.add(id);
    if (record['disabled'] !== undefined && typeof record['disabled'] !== 'boolean') {
      return rowFail(`插件 ${id} 行 disabled 须为布尔`);
    }
    if (
      record['config'] !== undefined &&
      (typeof record['config'] !== 'object' || record['config'] === null || Array.isArray(record['config']))
    ) {
      return rowFail(`插件 ${id} 行 config 须为对象（整值替换非合并）`);
    }
    // opens 三查（03 §4.6/§5.3 批 U1 增位——拒绝式不留静默通道）
    let opens: readonly string[] | undefined;
    if (record['opens'] !== undefined) {
      if (!Array.isArray(record['opens']) || record['opens'].some((o) => typeof o !== 'string' || o.length === 0)) {
        return rowFail(`插件 ${id} 行 opens 须为非空字符串数组（高危面开门授予位——03 §4.6）`);
      }
      const values = record['opens'] as readonly string[];
      const illegal = values.find((o) => !USER_GRANTABLE_CAPABILITIES.includes(o));
      if (illegal !== undefined) {
        return rowFail(
          `插件 ${id} 行 opens 含非法能力位 "${illegal}"——值域 = 高危面名单单源（现役：${USER_GRANTABLE_CAPABILITIES.join('、')}；常规能力位不走开门制）`,
        );
      }
      if (id.startsWith('core:')) {
        return rowFail(
          `官方件 ${id} 行不设 opens——core: 件高危面窄面注入走宿主装配裁决，不走用户开门位（03 §4.6 治理判据：开门不可被静默继承）`,
        );
      }
      opens = values;
    }
    rows.push({
      id,
      config: record['config'],
      disabled: record['disabled'] === undefined ? undefined : (record['disabled'] as boolean),
      ...(opens !== undefined ? { opens } : {}),
    });
  }
  return { ok: true, rows, doors: doors ?? [] };
}

/** 行失败速记 */
function rowFail(message: string): EnabledRowsInvalid {
  return { ok: false, code: 'PLUGIN_ROW_INVALID', message };
}
