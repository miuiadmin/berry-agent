/**
 * host/import-gate — 插件 import 门禁三道白名单执法件（03 §3.3；批 12d）。
 *
 * 三道白名单：① 虚拟面六键（§3.2 表——闭集，越出键表的 `berry-agent/*` 子径
 * 同拒）；② `node:` 内建（裸内建名〔无前缀〕不在道内——白名单字面只收
 * `node:` 形）；③ 插件目录树内（相对导入 + 自带 node_modules——裸第三方
 * 说明符由「能否在插件树内解析」判，解析不可达即拒）。
 *
 * 执法 = **字面量腿**（单腿——03 §3.3 批 12d 勘正）：装载期 jiti transform
 * 钩子拦截说明符（静态 import/export-from/require + 动态字面量
 * `import('…')`/`require('…')` 全扫），越界即**抛** `PLUGIN_IMPORT_FORBIDDEN`
 * ——jiti 主求值径只消费 transform 产码、error 通道仅 debug 日志（2026-09-07
 * 探针实证），故 throw 直抛是唯一拒载通道；配套 jiti `fsCache:false`（缓存
 * 键不含门禁身份——命中即跳过 transform 穿门，装载器件负责关）。原设计
 * 运行期兜底腿（前置守卫注入/裸内建 alias 毒丸）经 jiti v2 公开面核实无
 * 注入位（裸内建名 builtin 短路判在 alias/resolve 之前）——结构性不可实现，
 * 残差（动态拼接裸内建名/绝对径逃逸）随沙箱立题裁，详 03 §3.3 勘正段。
 *
 * 辖域 = 插件自有码：入口与相对导入的自有模块全扫；插件树 `node_modules/`
 * 子树内第三方码豁免（npm 生态惯例裸内建与 `node:` 形语义等价——豁免只
 * 跳过裁决、babel 链转照常）。辖域判定 = 两侧 realpath 归一后路径前缀比对
 * （macOS `/var` ↔ `/private/var` 符号链径差异防假阴性）；符号链接形态的
 * 深层对齐（install 期记 realpath）归装机腿落码批收口。
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createJiti, type Jiti, type TransformOptions, type TransformResult } from 'jiti';

import { BaseError } from '../contracts/index.js';

import { BARE_BUILTINS } from './builtins.js';

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
}

/**
 * 单说明符白名单裁决（纯谓词——字面量腿的裁决核）。
 *
 * 判序：node: 前缀 → 虚拟键闭集（`berry-agent`/`typebox` 前缀但越出键表 =
 * 越界拒）→ 相对导入（./ ../——树内 containment 由解析保证）→ 绝对路径
 * （file: / 盘符——直拒：插件面无绝对径合法位）→ 裸说明符（resolveBare
 * 判，缺席即拒 fail-closed）。
 */
export function checkImportSpecifier(specifier: string, ctx: ImportGateContext = {}): true | BaseError {
  if (specifier.startsWith('node:')) return true; // 道②：node: 内建
  if (VIRTUAL_KEYS.includes(specifier)) return true; // 道①：虚拟键闭集
  if ((specifier.startsWith('berry-agent') || specifier.startsWith('typebox')) && !specifier.startsWith('./')) {
    // 虚拟键域内越出键表（berry-agent/unknown、typebox/extra）——闭集外即拒
    return forbidden(specifier, '虚拟键域内未知子径（键表闭集外）');
  }
  if (specifier.startsWith('./') || specifier.startsWith('../')) return true; // 道③：相对导入
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
  /** 委托 transform（缺省自建无门禁 jiti 实例的 babel transform——公开 API 链转；测试注入位） */
  readonly delegate?: (opts: TransformOptions) => string;
}

/**
 * 字面量腿 transform：辖域内文件扫描说明符字面量 → 白名单裁决 → 越界即
 * **抛** `PLUGIN_IMPORT_FORBIDDEN`（jiti 把 transform 抛错直接传导给装载方
 * ——error 通道不抛已实证）；在道内则链委托 babel transform 产码（第二
 * jiti 实例的公开 `.transform()` 法，fsCache 关闭——委托自身缓存不受门禁
 * 影响但求确定性关闭）。
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
      const verdict = checkImportSpecifier(spec, { resolveBare: options.resolveBare });
      if (verdict !== true) {
        // 越界即拒——throw 直抛（唯一拒载通道；error 通道仅 debug 日志不抛）
        throw new BaseError(verdict.code, `[${options.pluginId}] ${verdict.message}`);
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
 */
function isPluginOwnCode(filename: string | undefined, pluginRoot: string): boolean {
  if (filename === undefined) return true; // 无文件名（eval 串）——保守全扫
  const normalized = normalizePath(filename);
  const prefix = pluginRoot.endsWith('/') ? pluginRoot : `${pluginRoot}/`;
  if (!normalized.startsWith(prefix) && !filename.startsWith(prefix)) return true; // 树外文件（理论不达）——保守全扫
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

/** jiti 实例面再导出（loader 组装位类型收窄用） */
export type { Jiti };
