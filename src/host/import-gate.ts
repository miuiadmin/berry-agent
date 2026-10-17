/**
 * host/import-gate — 插件 import 门禁三道白名单执法件（03 §3.3；批 12d）。
 *
 * 三道白名单：① 虚拟面六键（§3.2 表——闭集，越出键表的 `berry-agent/*` 子径
 * 同拒）；② `node:` 内建**分级两档**（§3.3 :350-357——放行档纯计算闭集
 * {PURE_COMPUTATION_BUILTINS} 缺省免门；受门档生效集 = 清单声明 ∩ 用户开门，
 * 装载时点快照注入〔本裁决核无运行期查面〕，越出拒 `PLUGIN_NODE_BUILTIN_FORBIDDEN`
 * ——与道外越界的 PLUGIN_IMPORT_FORBIDDEN 分码分归因；裸内建名〔无前缀〕
 * 不在道内——白名单字面只收 `node:` 形）；③ 插件目录树内（相对导入 +
 * 自带 node_modules——裸第三方说明符由「能否在插件树内解析」判，解析不可
 * 达即拒）。
 *
 * 执法 = **执法腿两腿化**（03 §3.3 批 12d 勘正 + 2026-10-18 勘正——同一
 * 裁决核的两条装配腿）：① transform 腿——装载期 jiti transform 钩子拦截
 * 说明符（静态 import/export-from/require + 动态字面量 `import('…')`/
 * `require('…')` 全扫），越界即**抛** `PLUGIN_IMPORT_FORBIDDEN`——jiti 主
 * 求值径只消费 transform 产码、error 通道仅 debug 日志（2026-09-07 探针
 * 实证），故 throw 直抛是唯一拒载通道；② 装载前置源扫腿（2026-10-18）——
 * jiti 对原生 ESM 求值路径（包清单 `type: "module"` 判 ESM 的入口）直接走
 * 原生 import()，transform 钩子结构性零调用（tryNative 等公开旋钮均不达
 * ——探针实证），字面量腿对该形态整体失明；本腿在 jiti 求值前从入口对
 * 插件自有码图裸源扫描（prescanPluginOwnGraph），与 ① 同核（同函数复用）
 * 同码同律拒载，转译路径文件 ① 照扫（同核幂等——双扫 verdict 恒一致）。
 * 配套 jiti `fsCache:false`（缓存键不含门禁身份——命中即跳过 transform
 * 穿门，装载器件负责关）。原设计运行期兜底腿（前置守卫注入/裸内建 alias
 * 毒丸）经 jiti v2 公开面核实无注入位（裸内建名 builtin 短路判在 alias/
 * resolve 之前）——结构性不可实现，残差（动态拼接裸内建名/绝对径逃逸/
 * 非字面量动态说明符）随沙箱立题裁，详 03 §3.3 勘正段。
 *
 * 辖域 = 插件自有码：入口与相对导入的自有模块全扫；插件树 `node_modules/`
 * 子树内第三方码豁免（npm 生态惯例裸内建与 `node:` 形语义等价——豁免只
 * 跳过裁决、babel 链转照常）。辖域判定 = 两侧 realpath 归一后路径前缀比对
 * （macOS `/var` ↔ `/private/var` 符号链径差异防假阴性）；符号链接形态的
 * 深层对齐（install 期记 realpath）归装机腿落码批收口。
 */
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, extname, join, resolve as resolvePath, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createJiti, type Jiti, type TransformOptions, type TransformResult } from 'jiti';

import { BaseError } from '../contracts/index.js';

import { BARE_BUILTINS, PURE_COMPUTATION_BUILTINS } from './builtins.js';

/** 虚拟面六键闭集（03 §3.2 定名表——同实例注入的真源清单） */
export const VIRTUAL_KEYS: readonly string[] = [
  'berry-agent',
  'berry-agent/llm',
  'berry-agent/sqlite',
  'typebox',
  'typebox/value',
  'typebox/compile',
];

/** 门禁判上下文（裸说明符解析位注入——缺省 fail-closed 拒） */
export interface ImportGateContext {
  /** 裸说明符是否可在插件目录树内解析（自带 node_modules——树内第三道） */
  readonly resolveBare?: (specifier: string) => boolean;
  /**
   * 受门档 node: 内建生效集（`node:<bare>` 全形闭集——boot 装载序注入的
   * 「清单声明 ∩ 用户开门」两方交集快照）。
   *
   * 缺席 = 分级腿未接线（诊断/替身形直调本谓词）——道②回历史行为全放行
   * （生产装载链恒注入——装机收割腿除外，见 plugin-install harvestEvents
   * 注：装机时点生效集两源皆 boot 读侧、结构性缺席，受门拒载归装载期执法，
   * 故缺席非执法面豁免口）；**注入即执法**：空集 =
   * 受门档全拒（声明缺省即默认关——03 §3.3 :357 fail-closed）。
   */
  readonly gatedNodeBuiltins?: ReadonlySet<string>;
}

/**
 * 单说明符白名单裁决（纯谓词——字面量腿的裁决核）。
 *
 * 判序：node: 前缀 → **道②分级**（放行档闭集短路 → 未接线放行 → 受门档
 * 生效集判——§3.3 :350-357）→ 虚拟键闭集（`berry-agent`/`typebox` 前缀但
 * 越出键表 = 越界拒）→ 相对导入（./ ../——白名单层放行，树内 containment
 * 由 transform 腿以 filename 为基另行执法〔本谓词无文件语境〕）→ 绝对路径
 * （file: / 盘符——直拒：插件面无绝对径合法位）→ 裸说明符（resolveBare
 * 判，缺席即拒 fail-closed）。
 */
export function checkImportSpecifier(specifier: string, ctx: ImportGateContext = {}): true | BaseError {
  if (specifier.startsWith('node:')) {
    // 道②分级：首段裸名归级（子径族 node:fs/promises 按首段——声明面裸名枚）
    const bare = specifier.slice('node:'.length).split('/')[0] ?? '';
    // 放行档闭集短路——纯计算内建缺省免门（三道白名单叙事对此集零变化）
    if (PURE_COMPUTATION_BUILTINS.has(bare)) return true;
    // 分级腿未接线（诊断/替身形直调）——回历史行为全放行；注入即执法（空集 = 全拒）
    if (ctx.gatedNodeBuiltins === undefined) return true;
    // 受门档：生效集（声明 ∩ 开门快照）内放行——比对按首段裸名形（声明面
    // 裸名枚〔深校验三拒拒子径形〕，node:fs 授予即覆 node:fs/promises 族）
    if (ctx.gatedNodeBuiltins.has(`node:${bare}`)) return true;
    return nodeBuiltinForbidden(specifier);
  }
  if (VIRTUAL_KEYS.includes(specifier)) return true; // 道①：虚拟键闭集
  if ((specifier.startsWith('berry-agent') || specifier.startsWith('typebox')) && !specifier.startsWith('./')) {
    // 虚拟键域内越出键表（berry-agent/unknown、typebox/extra）——闭集外即拒
    return forbidden(specifier, '虚拟键域内未知子径（键表闭集外）');
  }
  // 道③：相对导入——白名单层放行（containment 执法在 transform 腿：filename
  // 在手才能 resolve 判界，'../' 链解析逃出插件树在那里拒）
  if (specifier.startsWith('./') || specifier.startsWith('../')) return true;
  if (/^(\/|[a-zA-Z]:[\\/]|file:)/.test(specifier)) {
    return forbidden(specifier, '绝对路径不在白名单（插件面合法径只有三道）');
  }
  if (specifier.length === 0) return forbidden(specifier, '空说明符');
  // 裸说明符（内建裸名 / 第三方包名）——树内解析可达才放行
  if (ctx.resolveBare?.(specifier) === true) return true;
  if (BARE_BUILTINS.has(specifier)) {
    return forbidden(specifier, '裸内建名被拒——用 node: 前缀（白名单道②字面只收 node: 形）');
  }
  return forbidden(specifier, '裸说明符在插件目录树内不可解析（依赖自捆——03 §9.3）');
}

/** 越界裁决产物（携带码与因由——统一抛形） */
function forbidden(specifier: string, reason: string): BaseError {
  return new BaseError('PLUGIN_IMPORT_FORBIDDEN', `import 越界拒载：${specifier}（${reason}——三道白名单见 03 §3.3）`);
}

/**
 * 受门档 node: 内建未授裁决产物（§3.3 道②分级 / §4.2 第二维——与
 * PLUGIN_IMPORT_FORBIDDEN 分码分归因：三道白名单闭集外越界 vs 道②门内
 * 未授；生效集 = 清单声明 ∩ 用户开门，快照装载时点注入，/reload 重算）。
 */
function nodeBuiltinForbidden(specifier: string): BaseError {
  return new BaseError(
    'PLUGIN_NODE_BUILTIN_FORBIDDEN',
    `受门档 node: 内建未授拒载：${specifier}（不在「清单声明 ∩ 用户开门」生效集——grants.nodeBuiltins 声明 + grants.node-builtins 开门见 03 §3.3/§4.2）`,
  );
}

/**
 * 裸说明符树内解析位工厂（道③「自带 node_modules」的判定真源——装载腿与
 * 装机收割腿两装配位共用的单源注入件）。
 *
 * 判定 = createRequire 以 pluginDir 为基做 node 解析（`resolve(specifier)` 从
 * pluginDir 起向上找 node_modules——与 node/npm 惯例同解析律），命中后经
 * normalizePath 前缀判须落在 pluginDir 树内：向上爬出的解析（数据目录根/宿主
 * 依赖/全局）不算树内自带——fail-closed 拒。内建裸名（`fs` 等）在 require
 * 解析下原样返回自身（非路径形），天然不过树内前缀判 → 仍走裸内建拒载分支。
 * 解析失败（依赖未自捆）抛 ERR_MODULE_NOT_FOUND → false（拒）。
 */
export function createTreeBareResolver(pluginDir: string): (specifier: string) => boolean {
  // createRequire 基须是文件路径——以包清单文件为锚（与装载器 jiti 基同源）
  const requireFromPlugin = createRequire(join(pluginDir, 'package.json'));
  const root = normalizePath(pluginDir); // 两侧同尺归一（realpath——macOS /var ↔ /private/var 同律）
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  return (specifier: string): boolean => {
    try {
      const resolved = requireFromPlugin.resolve(specifier);
      return normalizePath(resolved).startsWith(prefix);
    } catch {
      return false; // 不可解析 = 未自捆——拒（fail-closed）
    }
  };
}

/** 说明符字面量抽取正则族（静态 + 动态字面量——注释/字符串内误伤由「越界即拒」的保守面消化） */
const SPECIFIER_PATTERNS: readonly RegExp[] = [
  /(?:^|[\s;}])(?:import|export)\s+(?:type\s+)?[\s\S]*?from\s*['"]([^'"]+)['"]/g, // import/export … from '…'
  /(?:^|[\s;}])import\s*['"]([^'"]+)['"]/g, // 副作用 import '…'
  /(?:^|[\s;[(!,:=])require\s*\(\s*['"]([^'"]+)['"]\s*\)/g, // require('…')（含动态字面量）
  /(?:^|[\s;[(!,:=])import\s*\(\s*['"]([^'"]+)['"]\s*\)/g, // import('…')（动态字面量）
];

/**
 * 抽取源文本中的全部说明符字面量（字面量腿的扫描核——纯函数可单测）。
 */
export function extractImportSpecifiers(source: string): readonly string[] {
  const found: string[] = [];
  for (const pattern of SPECIFIER_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(source)) !== null) {
      const spec = match[1];
      if (spec !== undefined) found.push(spec);
    }
  }
  return found;
}

/** 门禁 transform 工厂选项 */
export interface GateTransformOptions {
  /** 插件 id（拒载报文点名） */
  readonly pluginId: string;
  /** 插件目录根（辖域判定基——node_modules 子树豁免） */
  readonly pluginDir: string;
  /** 裸说明符解析位（与 checkImportSpecifier 同源） */
  readonly resolveBare?: (specifier: string) => boolean;
  /**
   * 受门档 node: 内建生效集（`node:<bare>` 全形——boot 注入的两方交集快照；
   * 缺省 = 分级腿未接线，道②历史行为全放行——装载链恒注入〔loader 组装位〕）
   */
  readonly gatedNodeBuiltins?: ReadonlySet<string>;
  /** 委托 transform（缺省自建无门禁 jiti 实例的 babel transform——公开 API 链转；测试注入位） */
  readonly delegate?: (opts: TransformOptions) => string;
}

/**
 * 相对导入 containment 判定（transform 腿执法——filename 在手才能 resolve 判界）。
 *
 * 以 filename 目录为基 resolve 说明符，归一（realpath——符号链逃逸同拦）后经
 * 前缀判须落在 pluginDir 树内；树内合法 `../`（如 `deep/../util.js` 归一回
 * 插件根）不误伤。返回 true = 树内放行 / false = 解析逃逸；filename 缺席
 * （eval 串）返回 undefined——无基可判，跳过 containment（文件基形才可执法）。
 */
function relativeEscape(specifier: string, filename: string | undefined, pluginRoot: string): boolean | undefined {
  if (filename === undefined) return undefined;
  // 基先归一（realpath）：jiti 只对存在文件调 transform，基可达 canonical 形
  // ——此后目标缺席（尚未落盘的相对引用）仍留在同尺前缀空间，不因符号链径
  // 差异（/var ↔ /private/var）误判逃逸（缺席目标归 jiti 解析失败红，非门禁拒）
  const base = normalizePath(filename);
  const resolved = normalizePath(resolvePath(dirname(base), specifier));
  const prefix = pluginRoot.endsWith(sep) ? pluginRoot : `${pluginRoot}${sep}`;
  return !(resolved === pluginRoot || resolved.startsWith(prefix));
}

/**
 * 字面量腿 transform：辖域内文件扫描说明符字面量 → 白名单裁决 → 越界即
 * **抛** `PLUGIN_IMPORT_FORBIDDEN`（jiti 把 transform 抛错直接传导给装载方
 * ——error 通道不抛已实证）；在道内则链委托 babel transform 产码（第二
 * jiti 实例的公开 `.transform()` 法，fsCache 关闭——委托自身缓存不受门禁
 * 影响但求确定性关闭）。相对导入另有 containment 执法腿：`../` 链解析逃出
 * 插件树即拒（market 布局深层 `../../…` 可达树外任意 JS——宿主源码模块
 * 结构性不可达的机器保证在此兑现）。
 */
export function createGateTransform(options: GateTransformOptions): (opts: TransformOptions) => TransformResult {
  let delegate = options.delegate;
  if (delegate === undefined) {
    const util = createJiti(import.meta.url, { fsCache: false });
    delegate = (opts) => util.transform(opts);
  }
  const pluginRoot = normalizePath(options.pluginDir); // 辖域基归一（realpath——与 filename 同尺比对）
  return (opts: TransformOptions): TransformResult => {
    if (!isPluginOwnCode(opts.filename, pluginRoot)) {
      return { code: delegate(opts) }; // node_modules 子树豁免——第三方码按生态惯例
    }
    for (const spec of extractImportSpecifiers(opts.source)) {
      const verdict = checkImportSpecifier(spec, {
        resolveBare: options.resolveBare,
        // 受门档生效集快照注入（缺省未接线 = 道②静默——见 GateTransformOptions 注）
        gatedNodeBuiltins: options.gatedNodeBuiltins,
      });
      if (verdict !== true) {
        // 越界即拒——throw 直抛（唯一拒载通道；error 通道仅 debug 日志不抛）
        throw new BaseError(verdict.code, `[${options.pluginId}] ${verdict.message}`);
      }
      // 相对径 containment 执法（道③补腿）：resolve 归一后出插件树 = 逃逸拒
      if (spec.startsWith('./') || spec.startsWith('../')) {
        if (relativeEscape(spec, opts.filename, pluginRoot) === true) {
          const escaped = forbidden(spec, '相对导入解析逃逸插件目录树');
          throw new BaseError(escaped.code, `[${options.pluginId}] ${escaped.message}`);
        }
      }
    }
    return { code: delegate(opts) };
  };
}

/**
 * 辖域判定：文件在 pluginDir 之下且不含 node_modules 段 = 插件自有码。
 *
 * 两侧 realpath 归一后前缀比对（macOS 临时目录 `/var` ↔ `/private/var` 符号
 * 链径差异会使裸前缀比对假阴性 → 好依赖被当树外保守全扫）；file: URL 形
 * 防御性归一（jiti 版本间 filename 形态差异）。符号链接形态的深层正规化
 * 归装机腿落码批对齐（install 期记录 realpath 后此处自然收口）。
 *
 * 树外文件「保守全扫」非多余位：transform 腿历史上可被相对径 '../' 链逃逸
 * 后带到树外文件（该逃逸已由 relativeEscape 执法腿封堵——逃出者进不到
 * jiti 求值），此处保守全扫是对一切残余到达形的防御位（纵深，非唯一防线）。
 */
function isPluginOwnCode(filename: string | undefined, pluginRoot: string): boolean {
  if (filename === undefined) return true; // 无文件名（eval 串）——保守全扫
  const normalized = normalizePath(filename);
  const prefix = pluginRoot.endsWith('/') ? pluginRoot : `${pluginRoot}/`;
  if (!normalized.startsWith(prefix) && !filename.startsWith(prefix)) return true; // 树外文件（防御位全扫——见上注）
  const effective = normalized.startsWith(prefix) ? normalized : filename;
  return !effective.slice(prefix.length).includes('node_modules/');
}

/** 路径归一：file: URL → 路径 + realpath（不可达原样返回——保守） */
function normalizePath(filename: string): string {
  const plain = filename.startsWith('file:') ? fileURLToPath(filename) : filename;
  try {
    return realpathSync(plain);
  } catch {
    return plain;
  }
}

/* ---------------- 装载前置源扫腿（2026-10-18 勘正——jiti 原生 ESM 绕行补执法） ---------------- */

/**
 * 源扫辖域的码扩展名单（jiti 解析扩展表的源扫镜像——.json 等非码文件零
 * 说明符可扫，跳过即零误伤）。
 */
const SCAN_SOURCE_EXTENSIONS: readonly string[] = [
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.mtsx',
  '.ctsx',
];

/** 前置源扫选项（与 GateTransformOptions 同族——两腿共用同一裁决核的外在形） */
export interface PreScanOptions {
  /** 插件 id（拒载报文点名） */
  readonly pluginId: string;
  /** 插件目录根（辖域判定基——node_modules 子树豁免同律） */
  readonly pluginDir: string;
  /** 入口文件绝对路径（源扫图遍历起点） */
  readonly entryPath: string;
  /** 裸说明符解析位（与 checkImportSpecifier 同源） */
  readonly resolveBare?: (specifier: string) => boolean;
  /** 受门档 node: 内建生效集（缺席 = 道②分级腿未接线——同 transform 腿镜像律） */
  readonly gatedNodeBuiltins?: ReadonlySet<string>;
  /** 源读面（缺省 readFileSync——测试注入位；返 null = 读不达跳过） */
  readonly readSource?: (path: string) => string | null;
}

/** 缺省源读面：utf8 读文件，读不达返 null（入口缺席等形归 jiti 解析失败红——本腿不抢跑） */
function defaultReadSource(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/**
 * 相对说明符的文件解析探测（jiti 解析序的最小镜像：精确命中 → 扩展名补 →
 * 目录 index）。解析不达返 null——递归腿跳过（jiti 求值期自会以更诚实的
 * 解析失败红，门禁不代跑解析错）。原生 ESM 合法的 cache-bust 尾
 * （`./util.js?v=2`）先剥 query/fragment 再探测——尾不剥则精确候选永缺席。
 */
function resolveRelativeTarget(fromDir: string, specifier: string): string | null {
  const cleaned = specifier.replace(/[?#].*$/, ''); // 剥 query/fragment 尾（containment 前缀判不受尾影响）
  const base = resolvePath(fromDir, cleaned);
  const candidates = [
    base,
    ...SCAN_SOURCE_EXTENSIONS.map((ext) => `${base}${ext}`),
    ...SCAN_SOURCE_EXTENSIONS.map((ext) => join(base, `index${ext}`)),
  ];
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // 探测缺席——次候选
    }
  }
  return null;
}

/**
 * 入口顶点解析探测（冷读闸 P2 清偿——无扩展/目录形入口零扫描即放行的洞）：
 * 精确文件在场即用（**含无扩展形**——node 按精确路径照样执行，探针实证）；
 * 否则走相对解析序（扩展名补全 + 目录 index——`entry:"lib/index"` /
 * `main:"lib"` 两形同达）；全不达透传裸径（归 jiti 诚实解析失败红，本腿
 * 不抢跑——node 原生径只执行 .js/.mjs/.cjs 三族皆在扫描名单，点扩展非码
 * 形 node 拒执行回落 transform 腿，无零扫描放行残差）。
 */
function resolveEntryTarget(entryPath: string): string {
  try {
    if (statSync(entryPath).isFile()) return entryPath;
  } catch {
    // 探测缺席——走解析序
  }
  const resolved = resolveRelativeTarget(dirname(entryPath), basename(entryPath));
  return resolved ?? entryPath;
}

/**
 * 装载前置源扫腿：从入口对插件自有码图裸源扫描说明符字面量，与 transform
 * 腿同一裁决核（extractImportSpecifiers + checkImportSpecifier +
 * relativeEscape——同函数复用非复刻），越界同码同律拒载。
 *
 * 缘起（03 §3.3 2026-10-18 勘正笔）：jiti v2 对原生 ESM 求值路径（包清单
 * `type: "module"` 判 ESM 的入口）直接走原生 import()，transform 钩子结构
 * 性零调用（tryNative / transformOptions 等公开旋钮均不达——探针实证）——
 * 字面量腿对该装载形态整体失明。本腿在 jiti 求值**前**扫源，覆盖原生 ESM
 * 路径；转译路径文件由 transform 腿照扫（同核幂等——双扫 verdict 恒一致，
 * 成本可忽略：插件自有码图有界）。
 *
 * 图遍历语义：相对导入递归深入（visited 防环，query/fragment 尾先剥——原生
 * ESM 合法 cache-bust 形）；node_modules 子树与树外文件豁免（isPluginOwnCode
 * 同判——第三方码按生态惯例）；非码**点扩展**跳过（.json 等——无扩展文件不
 * 跳过，入口顶点先过解析探测：精确文件/扩展名补全/目录 index 三形同达，
 * 冷读闸 P2 清偿）；裸说明符 / node: / 虚拟键说明符零递归（递归只沿相对径
 * ——其余形态的求值归 jiti / 原生 loader，白名单裁决已在前置判完成）。
 */
export function prescanPluginOwnGraph(options: PreScanOptions): true | BaseError {
  const pluginRoot = normalizePath(options.pluginDir);
  const read = options.readSource ?? defaultReadSource;
  const visited = new Set<string>();
  // 入口顶点先过解析探测（P2 修）：无扩展精确文件 / 扩展名补全 / 目录 index
  // 三形同达扫描起点——裸 entryPath 直接入队则无扩展/目录形过不了扩展门。
  const queue: string[] = [normalizePath(resolveEntryTarget(options.entryPath))];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (visited.has(file)) continue; // 防环（circular import 图合法形）
    visited.add(file);
    if (!isPluginOwnCode(file, pluginRoot)) continue; // node_modules/树外豁免同律
    // 扩展门（P2 修）：有扩展名且不在码名单才跳过（.json 等非码形）；无扩展
    // 文件**不跳过**——node/jiti 按精确路径照样装载（探针实证），跳过即放行洞。
    const fileExt = extname(file);
    if (fileExt !== '' && !SCAN_SOURCE_EXTENSIONS.includes(fileExt)) continue;
    const source = read(file);
    if (source === null) continue; // 读不达（入口缺席等）——jiti 解析失败红更诚实
    for (const spec of extractImportSpecifiers(source)) {
      const verdict = checkImportSpecifier(spec, {
        ...(options.resolveBare !== undefined ? { resolveBare: options.resolveBare } : {}),
        ...(options.gatedNodeBuiltins !== undefined ? { gatedNodeBuiltins: options.gatedNodeBuiltins } : {}),
      });
      if (verdict !== true) {
        return new BaseError(verdict.code, `[${options.pluginId}] ${verdict.message}`);
      }
      // 相对径 containment 执法（transform 腿同律）+ 递归深入
      if (spec.startsWith('./') || spec.startsWith('../')) {
        if (relativeEscape(spec, file, pluginRoot) === true) {
          const escaped = forbidden(spec, '相对导入解析逃逸插件目录树');
          return new BaseError(escaped.code, `[${options.pluginId}] ${escaped.message}`);
        }
        const target = resolveRelativeTarget(dirname(file), spec);
        if (target !== null) queue.push(normalizePath(target));
      }
    }
  }
  return true;
}

/** jiti 实例面再导出（loader 组装位类型收窄用） */
export type { Jiti };
