/**
 * L2 tools — fs 工具族（04 §7 fs 族段：read / write / edit / ls 四件；检索
 * 族 find/grep 挂批 7b）。
 *
 * 三道防线的关系（04 §7——三关全过才落盘）：
 * - fence（containment）：写/删目标 canonical 化后必须在可写根内。根经
 *   writableRoots provider 注入（safety 件的推导函数——本批未落，缺省
 *   workspace + 系统临时目录过渡）；进程内 canonicalize-then-contain 是
 *   防误操作护栏，非 security boundary；
 * - 观察态 CAS（observed.ts）：未读拒写 + 指纹守卫——「写的内容是否基于
 *   最新观察」；
 * - 补丁定位（apply-patch.ts）：context 行锚匹配——「改的位置是否还在」。
 *
 * 编码纪律（04 §7，本仓裁决：UTF-8 严格、无逃生参数）：文本读 = strict
 * TextDecoder（fatal）+ UTF-8 BOM 剥离照读；lossy 即 FS_DECODE_NON_UTF8
 * 拒（绝不静默 mojibake 进上下文）。ACP 决策树/本地码页转码/encoding 参数
 * 挂真实需求另裁（蓝本独有，规范未纳）。
 *
 * edit 两阶段编排：补丁全部操作先「解析 + fence + CAS + 定位」校验并计算
 * 目标内容，全过才顺序落盘——语义错误（定位失败/未读/CAS 冲突/非 UTF-8）
 * 全部前置暴露，非原子窗口（跨文件顺序应用、无回滚——规范声明语义）只剩
 * 物理写失败一种。
 *
 * 写串行链（04 §7 写串行链条）：全部写路径（write 全段 / edit 两阶段全段）
 * 经 per-canonical-path **模块级**链互斥——多会话并发写同一物理文件时，后
 * 到写者的 stat→CAS 在前驱落盘后才跑，观察指纹必然过期被拒，不再有「两写
 * 者都过 CAS、后写静默覆盖先写」的丢失更新。链与实例无关（物理文件系统
 * 只有一块——挂实例即漏互斥）。
 */
import { basename, dirname, extname, isAbsolute, join, resolve as resolvePath, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { Type } from 'typebox';
import { BaseError } from '../contracts/index.js';
import type { AgentToolResult, ToolDefinition } from '../contracts/index.js';
import { canonicalWorkspaceRoot } from '../context/index.js';
import { addLinesToContent, applyUpdateLines, parseApplyPatch } from './apply-patch.js';
import type { PatchOperation } from './apply-patch.js';
import { ObservedFiles, requireObservedForEdit, resolveWriteIntent, statVersion } from './observed.js';

/** fs 工具族选项（装配层注入，全部可换——测试面钉临时目录的标准位） */
export interface FsToolsOptions {
  /**
   * 可写根 provider（fence 数据源；返回绝对路径列表）。safety 件已落码——
   * 装配层应注入 safety.createRootsProvider 产物（与沙箱 profile 同源；host
   * 装配批接线）；缺省 = workspace 根 + 系统临时目录（过渡缺省，不随档位）。
   */
  writableRoots?: () => string[];
  /** 工作区锚点（相对路径 resolve 基准；缺省 canonical 工作区根〔context 单源〕） */
  workspace?: () => string;
  /** read 文本截断上限字节（缺省 256 KiB；超限保头截断 + 注记） */
  maxReadBytes?: number;
  /** read 图片分支上限字节（缺省 5 MiB；超限 isError 拒绝不截断——base64
   * 截断 = 损坏图片无意义，fail-loud 指路压缩后重读） */
  maxImageBytes?: number;
}

/**
 * 图片扩展名 → MIME（read 图片分支识别表）。按扩展名识别不做魔数嗅探：
 * 工具语义是「读给模型看」，伪图片由模型侧自然暴露——不为它加嗅探器。
 */
const IMAGE_MIME_BY_EXT: Readonly<Record<string, string>> = {
  ['.png']: 'image/png',
  ['.jpg']: 'image/jpeg',
  ['.jpeg']: 'image/jpeg',
  ['.gif']: 'image/gif',
  ['.webp']: 'image/webp',
};

/** fs 工具族产物：工具定义 + 共享观察表（测试/诊断面可达） */
export interface FsTools {
  /** 四件工具定义（read/write/edit/ls——装配层注册进驱动层） */
  tools: ToolDefinition[];
  /** 观察态登记表（族内共享；键 = resolve 后的用户拼写绝对路径） */
  observed: ObservedFiles;
}

/** 纯文本结果快捷构造（details 可选进结构化明细面） */
function textResult(text: string, details?: Record<string, unknown>): AgentToolResult {
  return { content: [{ type: 'text', text }], ...(details !== undefined ? { details } : {}) };
}

/**
 * canonical 化绝对路径：在场路径走 realpath（解析符号链）；不在场路径回退
 * 「最近在场祖先 realpath + 拼回尾部段」——保证 fence 比较双方都是真实位
 * 置：可写根内 symlink 指向根外的逃逸在 contain 检查处暴露（canonical 化
 * 后即出根）。递归上溯至文件系统根兜底（根自身无父）。
 */
export async function canonicalize(abs: string): Promise<string> {
  try {
    return await realpath(abs);
  } catch {
    const parent = dirname(abs);
    if (parent === abs) return abs; // 到达文件系统根
    const canonicalParent = await canonicalize(parent);
    return join(canonicalParent, basename(abs));
  }
}

/**
 * child 是否位于 root 内：相等或隔分隔符的前缀（防 /root 与 /root-evil 误
 * 判）。root 为文件系统根 sep（全盘可写形态的根）时任意绝对路径皆命中——
 * 特判与 safety 件（未落）将来的同款判定同语义，不 cross-import 防成环。
 */
function isInside(child: string, root: string): boolean {
  const prefix = root === sep ? sep : root + sep;
  return child === root || child.startsWith(prefix);
}

/** 当前盘上指纹（`${size}:${mtimeMs}`）；文件不在返回 undefined */
async function currentVersion(abs: string): Promise<string | undefined> {
  try {
    const s = await stat(abs);
    return statVersion(s.size, s.mtimeMs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err; // EACCES 等真实 I/O 错误照常上抛（工具失败面）
  }
}

/* ------------------------------------------------------------------ */
/* 写串行链（04 §7 写串行链条——per-canonical-path 模块级全局互斥）      */
/* ------------------------------------------------------------------ */

/**
 * per-canonical-path 写链尾登记（**模块级**——跨 createFsTools 实例共享：
 * 多会话各持一套 fs 族、子代理每子一套，但物理文件系统只有一块；链粒度 =
 * 物理路径，不挂任何实例/注册表——挂实例即漏互斥）。键 = canonical 绝对
 * 路径；值 = 最近写操作的占位 promise（已 settle 的旧值等价「空闲」，故
 * 值等价自清不影响语义）。
 */
const writeChains = new Map<string, Promise<void>>();

/**
 * 写操作互斥段（「同步原子段安装占位链尾」形态——互斥安装零 await）：
 *
 * 1. 同步原子段（零 await）：捕获全部涉及路径的当前链尾 + 将自身**占位**
 *    安装为各路径新链尾（多路径共享同一占位对象——edit 跨文件时的全序锚）；
 * 2. 等待前驱（Promise.all——等待边恒指向安装更早者，图无环无死锁）；
 * 3. 执行操作本体；
 * 4. settle 占位（无论成败——锁即释放，操作错误原样上抛）+ 值等价自清
 *    （某路径链尾仍是本占位才删键，防 Map 随路径集合无界增长）。
 *
 * 互斥原理：执行期各路径链尾恒为本操作占位——并发者在自己的原子段读到的
 * 是「链尾已占」而非「已 settle 的旧值」，必然排在本操作之后。
 *
 * @param paths 本次操作涉及的 canonical 路径全集（write 单路径；edit 多路径）
 * @param op 操作本体（互斥段内执行——覆盖 stat→CAS→物理写→观察回填全段）
 */
export async function serializeWrites<T>(paths: readonly string[], op: () => Promise<T>): Promise<T> {
  // 占位 promise：resolver 手持，settle 时机完全归本函数的 finally
  let release!: () => void;
  const placeholder: Promise<void> = new Promise<void>((resolve) => {
    release = resolve;
  });
  // 同步原子段：先捕获前驱再安装占位——两步之间零 await，并发者不可能插入
  const priors = paths.map((p) => writeChains.get(p) ?? Promise.resolve());
  for (const p of paths) writeChains.set(p, placeholder);
  try {
    await Promise.all(priors);
    return await op();
  } finally {
    release(); // settle 占位：等待者放行（与本操作成败无关）
    // 值等价自清：链尾仍指本占位才删（并发者已装上自己的占位时不动他者）
    for (const p of paths) {
      if (writeChains.get(p) === placeholder) writeChains.delete(p);
    }
  }
}

/**
 * 互斥段内写目标漂移重验：写链只互斥宿主写者——链外共享写者（外部进程对
 * workspace 的直接 OS 写权）不受链约束，可在链外 canonicalize〔T0〕→ 段
 * 内物理写〔T1〕窗口把任一父组件 swap 成符号链，writeFile/rm 跟随即宿主
 * 全权写出 fence 外（fence 只在链外验过一次，对 T1 真实落点不再过问）。
 * 修法 = 物理写前重跑 canonicalize 与链外定键比对，漂移即拒（fail-closed）。
 * 调用形态约束：重验完成与物理写之间零 await——重验是物理写前的最后一跳，
 * 残窗收敛至 realpath 走查与 open 提交之间的指令级窗（治本 = 父目录 fd 锚
 * 定或 temp+rename，挂真实攻击面拉动）。
 *
 * @param abs 用户拼写路径（重跑 canonicalize 的输入——与 T0 定键同源）
 * @param canonical 链外推导定键（T0 值）——比对基准
 */
export const assertTargetStable = async (abs: string, canonical: string): Promise<void> => {
  const nowCanonical = await canonicalize(abs);
  if (nowCanonical !== canonical) {
    throw new BaseError(
      'FS_WRITE_TARGET_DRIFTED',
      `[FS_WRITE_TARGET_DRIFTED] 写目标在互斥段内漂移：${abs} 现规范化 ${nowCanonical} ≠ 定键 ${canonical}（疑似父组件被符号链交换——拒绝落盘；请重新执行写操作）`,
    );
  }
};

/* ---------------- 编码纪律：UTF-8 严格解码 ---------------- */

/** UTF-8 BOM 字节序列（EF BB BF——在场即剥离照读，不进内容） */
const UTF8_BOM = '﻿';

/**
 * 严格 UTF-8 解码（04 §7 编码纪律）：fatal TextDecoder——任何非法字节序
 * 列 lossy 即抛 FS_DECODE_NON_UTF8（绝不产 U+FFFD 乱码进上下文）；UTF-8
 * BOM 剥离照读。无本地码页回退、无逃生参数（挂真实需求另裁）。
 */
function decodeUtf8Strict(raw: Buffer): string {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let text: string;
  try {
    text = decoder.decode(raw);
  } catch {
    throw new BaseError(
      'FS_DECODE_NON_UTF8',
      '[FS_DECODE_NON_UTF8] 文件非 UTF-8 编码（严格解码 lossy）——本仓文本面只认 UTF-8；如需处理其他编码文件请在 bash 侧转档后读写',
    );
  }
  // BOM 剥离（首字符 U+FEFF）——BOM 是传输层标记不是内容
  return text.startsWith(UTF8_BOM) ? text.slice(UTF8_BOM.length) : text;
}

/** 终态文本保头截断（至多 maxBytes 字节；截点落在多字节字符中间时回退到
 * 该字符起点——丢一个不完整字符，不产 U+FFFD 尾巴） */
function headUtf8(buf: Buffer, maxBytes: number): string {
  let end = Math.min(buf.length, maxBytes);
  while (end > 0 && (buf[end]! & 0xc0) === 0x80) end--;
  return buf.subarray(0, end).toString('utf8');
}

/**
 * 组装 fs 工具族（read / write / edit / ls）。观察表本函数创建并在族内共
 * 享——「读过什么」是工具族级状态（per-driver 一套：装配层把族注册进驱
 * 动层，观察态随会话生命周期）。
 */
export function createFsTools(opts: FsToolsOptions = {}): FsTools {
  const workspace = opts.workspace ?? (() => canonicalWorkspaceRoot());
  const writableRoots = opts.writableRoots ?? (() => [workspace(), tmpdir()]); // 过渡缺省（不随档位）；host 装配批换 safety.createRootsProvider
  const maxReadBytes = opts.maxReadBytes ?? 256 * 1024;
  const maxImageBytes = opts.maxImageBytes ?? 5 * 1024 * 1024;
  const observed = new ObservedFiles();

  /** 用户给出路径 → 绝对路径（相对路径锚 workspace；isAbsolute 直 resolve） */
  const resolveTarget = (p: string): string => (isAbsolute(p) ? resolvePath(p) : resolvePath(workspace(), p));

  /**
   * 写路径 fence：canonical 化后必须在某可写根内（根同样 canonical 化后
   * 比对）。只拦写/删——读任意位置允许（coding 场景读系统文件是常态）。
   * @returns canonical 化后的写目标（链键 + 物理写目标同源）
   */
  const assertWritable = async (abs: string): Promise<string> => {
    const canonical = await canonicalize(abs);
    for (const root of writableRoots()) {
      const canonicalRoot = await canonicalize(resolvePath(root));
      if (isInside(canonical, canonicalRoot)) return canonical;
    }
    throw new BaseError(
      'FS_OUTSIDE_WRITABLE_ROOTS',
      `[FS_OUTSIDE_WRITABLE_ROOTS] 写目标不在可写根内：${abs}（可写根：${writableRoots().join('、')}）`,
    );
  };

  /* ---------------- read：观察登记的唯一天然入口 ---------------- */
  const readTool: ToolDefinition = {
    name: 'read',
    effect: 'read',
    description:
      '读取文件内容。文本按 UTF-8 严格解码（带 BOM 自动剥离；非 UTF-8 报错，转档请走 bash）。图片文件（png/jpg/jpeg/gif/webp）返回 image 内容块可直接看图（上限 5MiB）。读取即登记观察态：后续 write/edit 必须基于本观察（文件被改动过会被版本守卫拒绝）。文件不存在时报错，但同样登记「不存在」观察（之后 write 创建该路径即合法）。',
    parameters: Type.Object({
      path: Type.String({ description: '文件路径（相对路径锚工作区根）' }),
    }),
    execute: async (args) => {
      const abs = resolveTarget(args.path as string);
      const version = await currentVersion(abs);
      if (version === undefined) {
        // 不在 = 错误 + 登记 absent 观察（调用失败但观察语义成立：模型看过「这里没有文件」）
        observed.observeAbsent(abs);
        throw new BaseError('FS_NOT_FOUND', `[FS_NOT_FOUND] 文件不存在：${abs}`);
      }
      // 图片分支：按扩展名识别 → image 块（base64 + mimeType）。不走文本
      // 截断护栏——图片自有界（管道输出护栏「只钳文本」同口径）
      const imageMime = IMAGE_MIME_BY_EXT[extname(abs).toLowerCase()];
      if (imageMime !== undefined) {
        const raw = await readFile(abs); // Buffer 原样（二进制面）
        if (raw.byteLength > maxImageBytes) {
          // 超限 = 可预期输入问题：isError 结果面拒绝（模型可自纠——压缩/裁剪
          // 后重读或放弃）；不 throw 不截断（base64 截断 = 损坏图片无意义）
          return {
            content: [
              {
                type: 'text',
                text: `图片过大：${abs}（${raw.byteLength} 字节 > 上限 ${maxImageBytes} 字节）。请压缩或裁剪后重读。`,
              },
            ],
            isError: true,
            details: { path: abs, bytes: raw.byteLength, limit: maxImageBytes, image: true, rejected: 'too-large' },
          };
        }
        observed.observePresent(abs, version);
        return {
          content: [
            { type: 'text', text: `${abs}（图片 ${imageMime}，${raw.byteLength} 字节）` },
            { type: 'image', data: raw.toString('base64'), mimeType: imageMime },
          ],
          details: { path: abs, bytes: raw.byteLength, mimeType: imageMime, image: true },
        };
      }
      // 文本分支：字节原样读入 → 严格 UTF-8 解码（lossy 即拒——绝不 mojibake）
      const raw = await readFile(abs);
      const text = decodeUtf8Strict(raw);
      // 截断护栏：保头 maxBytes 字节（UTF-8 安全截点）+ 非静默注记
      const truncated = Buffer.byteLength(text, 'utf8') > maxReadBytes;
      const content = truncated ? headUtf8(Buffer.from(text, 'utf8'), maxReadBytes) : text;
      observed.observePresent(abs, version);
      const truncNote = truncated ? `\n…（已截断至 ${maxReadBytes} 字节，完整内容请分段读取）` : '';
      return textResult(`${content}${truncNote}`, {
        path: abs,
        bytes: Buffer.byteLength(text, 'utf8'),
        truncated,
      });
    },
  };

  /* ---------------- write：按观察态分派 create/replace ---------------- */
  const writeTool: ToolDefinition = {
    name: 'write',
    effect: 'write',
    description:
      '写文件（整体替换内容）。运行时按观察态自动分派：从未读过且已存在 → 拒绝（先 read）；读过 → 仅当读取后未被修改才允许替换（版本守卫）；读时不存在 → 创建合法。写入成功即更新观察。写入一律按 UTF-8 落盘。',
    parameters: Type.Object({
      path: Type.String({ description: '目标文件路径（相对路径锚工作区根）' }),
      content: Type.String({ description: '完整文件内容（整体替换，非追加）' }),
    }),
    execute: async (args) => {
      const abs = resolveTarget(args.path as string);
      // 键推导先行：fence + canonical 化在链外完成——链键与物理写目标同为
      // 本操作定死的 canonical 路径（writeFile 落真实位置而非符号链拼写；
      // 观察键维持用户拼写 abs——read/write 同拼写一致，跨拼写别名是既有语义）
      const canonical = await assertWritable(abs);
      return serializeWrites([canonical], async () => {
        const current = await currentVersion(canonical);
        // CAS 分派：未读→create-if-absent；absent 观察→create；present→指纹守卫
        const intent = resolveWriteIntent(observed.get(abs), current === undefined ? undefined : { version: current });
        // 段内漂移重验：重验完成与物理写零 await 相接——swap 窗口收口
        await assertTargetStable(abs, canonical);
        await writeFile(canonical, args.content as string, 'utf8');
        // 写后回填观察：刚写入的内容即最新事实版本（立即 stat 产指纹，紧随
        // 的再次写不需重读）
        const after = await currentVersion(canonical);
        if (after !== undefined) observed.observePresent(abs, after);
        return textResult(
          `已写入 ${abs}（${intent.kind === 'create-if-absent' ? '新建' : '替换'}，${Buffer.byteLength(args.content as string, 'utf8')} 字节）`,
          {
            path: abs,
            kind: intent.kind,
            bytes: Buffer.byteLength(args.content as string, 'utf8'),
          },
        );
      });
    },
  };

  /* ---------------- edit：apply_patch 补丁（两阶段：全检后写） ---------------- */
  const editTool: ToolDefinition = {
    name: 'edit',
    effect: 'write',
    description:
      '按 apply_patch 补丁格式编辑文件（一次补丁可改多文件：Update File / Add File / Delete File）。Update/Delete 的目标必须先 read 过；全部校验通过后才落盘（跨文件顺序应用，非原子）。只接受 UTF-8 文件。',
    parameters: Type.Object({
      patch: Type.String({
        description:
          'apply_patch 格式补丁文本，形如：\n*** Begin Patch\n*** Update File: path\n context\n-old\n+new\n*** Add File: new.txt\n+content\n*** Delete File: old.txt\n*** End Patch',
      }),
    }),
    execute: async (args) => {
      const ops = parseApplyPatch(args.patch as string);
      // 键推导先行：逐 op fence + canonical 化在链外完成——本补丁涉及的全
      // 部 canonical 路径即链键全集（Map 去重；fence 每文件单独过——补丁
      // 夹带根外目标逐个暴露）
      const targets = new Map<string, { op: PatchOperation; abs: string }>();
      for (const op of ops) {
        const abs = resolveTarget(op.path);
        const canonical = await assertWritable(abs);
        targets.set(canonical, { op, abs });
      }
      // 两阶段全段入链：阶段一的读-CAS-算内容与阶段二的顺序落盘在同一互
      // 斥段内（阶段间窗口的并发写会让「已校验内容」过期——全段互斥才闭合）
      return serializeWrites([...targets.keys()], async () => {
        /** 阶段一产物：通过全部校验、目标内容已就绪的待应用操作 */
        const planned: Array<{ op: PatchOperation; abs: string; canonical: string; content?: string }> = [];
        for (const [canonical, { op, abs }] of targets) {
          const current = await currentVersion(canonical);
          const currentRef = current === undefined ? undefined : { version: current };
          if (op.kind === 'update') {
            // 编辑守卫：必须已读（present）且指纹一致；内容在阶段一就算好
            //（定位失败前置暴露——不留到半途落盘才发现）
            requireObservedForEdit(observed.get(abs), currentRef);
            // 前置读同 read 口径严格 UTF-8：非 UTF-8 一律拒改（防转码回写
            // 毁档）；改写通道 = read 后 write 全文替换（按 UTF-8 落盘）
            const raw = await readFile(canonical);
            const text = decodeUtf8Strict(raw);
            planned.push({ op, abs, canonical, content: applyUpdateLines(abs, text, op.lines) });
          } else if (op.kind === 'add') {
            if (currentRef !== undefined) {
              throw new BaseError(
                'FS_PATCH_FAILED',
                `[FS_PATCH_FAILED] *** Add File: ${abs} 目标已存在——修改已有文件请用 Update File`,
              );
            }
            planned.push({ op, abs, canonical, content: addLinesToContent(op.lines) });
          } else {
            // 删除守卫与 update 同款：删之前必须读过（知道删的是什么）
            requireObservedForEdit(observed.get(abs), currentRef);
            planned.push({ op, abs, canonical });
          }
        }
        /* 阶段二：顺序应用（无回滚——语义错误已在阶段一全部暴露，只剩物理
           写失败；物理写走 canonical，观察回填走用户拼写——与 write 同口径） */
        const summary: string[] = [];
        /** 结构化操作账（消费面 = 后续诊断注入等按 op 分型的面） */
        const operations: Array<{ op: string; path: string }> = [];
        for (const item of planned) {
          // 段内漂移重验：每个物理写（writeFile/rm）前逐项重验——与物理写
          // 零 await 相接，多文件补丁不因前项耗时给后项留窗
          await assertTargetStable(item.abs, item.canonical);
          if (item.op.kind === 'delete') {
            await rm(item.canonical);
            summary.push(`deleted ${item.op.path}`);
            operations.push({ op: 'delete', path: item.canonical });
            continue;
          }
          await writeFile(item.canonical, item.content!, 'utf8');
          const after = await currentVersion(item.canonical);
          if (after !== undefined) observed.observePresent(item.abs, after);
          summary.push(`${item.op.kind === 'add' ? 'added' : 'updated'} ${item.op.path}`);
          operations.push({ op: item.op.kind, path: item.canonical });
        }
        return textResult(`补丁已应用（${summary.length} 个操作）：\n${summary.join('\n')}`, {
          operations,
        });
      });
    },
  };

  /* ---------------- ls：目录列举（不登记观察——不构成内容观察） ---------------- */
  const lsTool: ToolDefinition = {
    name: 'ls',
    effect: 'read',
    description: '列出目录内容（名称 + 类型，目录带尾斜杠）。缺省列工作区根。',
    parameters: Type.Object({
      path: Type.Optional(Type.String({ description: '目录路径（缺省工作区根）' })),
    }),
    execute: async (args) => {
      const abs = resolveTarget((args.path as string | undefined) ?? '.');
      let entries;
      try {
        entries = await readdir(abs, { withFileTypes: true });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new BaseError('FS_NOT_FOUND', `[FS_NOT_FOUND] 目录不存在：${abs}`);
        }
        throw err;
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      const lines = entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
      return textResult(lines.length > 0 ? lines.join('\n') : '（空目录）', {
        path: abs,
        count: entries.length,
      });
    },
  };

  return { tools: [readTool, writeTool, editTool, lsTool], observed };
}
