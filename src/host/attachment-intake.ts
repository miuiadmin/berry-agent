/**
 * host — 剪贴板附件受理链（03 §10.4 ② 2026-10-08 剪贴板附件批：宿主装配
 * 桥受理链真身）+ image-ref 再水化单点（批注⑤——请求组装转换位读附件库
 * 还原 base64）。
 *
 * 受理链定位（件侧只透传不实现——词面独立律，执法位在本模块）：webui/SDK
 * submit 体 images 位逐件管线，链序钉死——能力门（模型目录 input 声明不含
 * 'image' 且 images 非空 → 拒；声明缺席不拦，诚实失败不臆断）→ 数量帽
 * 4 件/消息 → 逐件：base64 严格解码 → 字节帽 5MiB（解码后字节）→ 魔数
 * 嗅探四族白名单（PNG/JPEG/GIF/WebP——SVG 结构性禁入）→ 声明 MIME 与嗅探
 * 族核验（勿信声明）→ 尺寸帽 8192 任一边（零依赖头解析）→ sha256 内容寻址
 * 附件库幂等落盘 → 铸 image-ref 引用块。拒形 = AttachmentIntakeRejectionError
 * （status 400 照 host 既有拒形；零新 BaseError 注册码——受理拒非进程内
 * 错误轨）；拒路径零副作用辖 durable 会话面——附件库内容寻址落盘非破坏性
 * （逐件拒时前序件已写文件无害，03 §10.4 ②）；附件库写失败原样上抛
 * （fail-loud 受理 500 轨，不包不吞）。
 *
 * 再水化（convertToLlm 单点消费）：user 消息 content 块数组中的 image-ref
 * 引用块读附件库还原 ImageContent base64；文件缺席/读失败降「[图片已不可用]」
 * 文本占位（呈现不炸 run——投影与 durable 恒引用形不动，重播种侧零改）。
 */
import type { ImageContent, ImageRefContent, Message, ModelInfo, TextContent } from '../contracts/index.js';
import { ATTACHMENT_MIME_BY_EXT } from '../persist/index.js';
import type { AttachmentExt, AttachmentStore } from '../persist/index.js';

/* ---------------- 受理限值（单源常量——拷贝限值同源律） ---------------- */

/** 数量帽：一条消息最多粘贴图片件数（03 §10.4 ②——拷贝限值与件侧文案同源） */
export const ATTACHMENT_INTAKE_MAX_IMAGES = 4;

/** 字节帽：单件解码后字节上限（5MiB——read 工具 fs 先例同值；03 §10.4 ②） */
export const ATTACHMENT_INTAKE_MAX_BYTES = 5 * 1024 * 1024;

/** 尺寸帽：单件任一边像素上限（解压炸弹防线——零依赖头解析计量） */
export const ATTACHMENT_INTAKE_MAX_DIMENSION = 8192;

/** 标准带填充 base64 词法（受理位严格形——缺填充/空白/URL 形全拒） */
const BASE64_STRICT_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/* ---------------- 拒文案（五族单源——中文白话零黑话 07 §4.4） ---------------- */

/** 能力族：模型声明不含图输入 */
const REJECT_MODEL_INPUT = '当前模型不支持图片输入，请换用支持图片的模型或去掉图片后再发';

/** 数量族：件数超帽 */
const rejectCount = (): string => `一条消息最多带 ${ATTACHMENT_INTAKE_MAX_IMAGES} 张图片，请减少图片数量`;

/** 字节族：单件超 5MiB */
const rejectBytes = (index: number): string => `第 ${index} 张图片太大（超过 5 MiB 上限），请压缩后再发`;

/** 格式族：魔数四族外（SVG 结构性禁入） */
const rejectFormat = (index: number): string => `第 ${index} 张图片的格式不受支持（仅支持 PNG、JPEG、GIF、WebP）`;

/** 格式族（数据不完整变体）：魔数命中但头解析不出尺寸 */
const rejectTruncated = (index: number): string => `第 ${index} 张图片数据不完整，请重新复制后再粘贴`;

/** 格式族（声明核验变体）：声明 MIME 与嗅探族不一致 */
const rejectMimeMismatch = (index: number): string =>
  `第 ${index} 张图片声明的类型与实际内容不一致，请按图片实际格式重试`;

/** 尺寸族：任一边超 8192 */
const rejectDimension = (index: number): string =>
  `第 ${index} 张图片尺寸过大（任一边不能超过 ${ATTACHMENT_INTAKE_MAX_DIMENSION} 像素），请缩小后再发`;

/** 环境族：内存模式无数据目录（附件库诚实缺席） */
const REJECT_NO_STORE = '当前运行环境没有开启数据目录，无法接收图片';

/** base64 族（字节族前置解码位）：非标准 base64 */
const rejectBase64 = (index: number): string => `第 ${index} 张图片的数据不是有效的 base64 编码`;

/* ---------------- 入参与拒形 ---------------- */

/** 粘贴图受理入参（webui/SDK submit 体 images 位成员——03 §10.4 ①） */
export interface PasteImageInput {
  /** 图片原文 base64（标准带填充形——缺填充/含空白字符拒） */
  readonly data: string;
  /** 声明 MIME（受理链与魔数嗅探族核验——勿信客户端声明的单源执法位） */
  readonly mimeType: string;
}

/** 能力门查面（宿主装配桥组装注入——判据面纯读投影） */
export interface IntakeCapabilityFace {
  /** 会话生效模型 id（per-session 覆盖 ?? 栈基线——受理时点现取） */
  readonly modelOf: (sessionId: string) => string;
  /** 模型目录点查（缺声明 = undefined——能力门缺席不拦，诚实失败不臆断） */
  readonly modelInfoOf: (modelId: string) => ModelInfo | undefined;
}

/** 受理拒（照 host 既有拒形 status + message——非 BaseError 注册码轨；件侧窄 catch 按本位折 400） */
export class AttachmentIntakeRejectionError extends Error {
  /** HTTP 折位（受理拒 = 400 + 明示原因文案——03 §10.4 ②） */
  readonly status: 400 = 400;

  constructor(message: string) {
    super(message);
    this.name = 'AttachmentIntakeRejectionError';
  }
}

/* ---------------- 魔数嗅探与头解析（零依赖） ---------------- */

/** 嗅探族（四族白名单——ext/MIME 派生键与附件库白名单同源） */
type SniffFamily = AttachmentExt;

/**
 * 魔数嗅探（勿信扩展名/声明 MIME——03 §10.4 ② 白名单四族）：
 * PNG（89 50 4E 47 0D 0A 1A 0A）/ JPEG（FF D8 FF）/ GIF（47 49 46 38=
 * "GIF8"）/ WebP（"RIFF" + 4 字节长度 + "WEBP"）。四族外拒（SVG 头
 * 3C 73 76 67 结构性禁入——脚本执行面）。
 */
function sniffFamily(bytes: Uint8Array): SniffFamily | undefined {
  // PNG：八字节签名全核
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'png';
  }
  // JPEG：三字节魔数（SOI + JFIF/EXIF 段首）
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  // GIF："GIF8"（87a/89a 两版共同前四字节）
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return 'gif';
  }
  // WebP：RIFF 容器 + "WEBP" 四字符（偏移 8）
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'webp';
  }
  return undefined;
}

/** 嗅探族 → 附件库 ext（白名单成员直映——增族须两处同笔见附件库头注） */
const EXT_BY_FAMILY: Record<SniffFamily, AttachmentExt> = {
  png: 'png',
  jpeg: 'jpeg',
  gif: 'gif',
  webp: 'webp',
};

/**
 * 尺寸头解析（零依赖——尺寸帽判据）：返回 {width, height}；族内数据不完整
 * （头截断/JPEG 无 SOF 段）返回 undefined → 格式族拒。
 *  - PNG：IHDR 大端 u32 宽 @16 高 @20（签名 8 + 段长 4 + "IHDR" 4）；
 *  - GIF：逻辑屏幕小端 u16 宽 @6 高 @8；
 *  - JPEG：段扫描找 SOF（C0-CF 除 C4/C8/CC）——高 @段首+5 宽 @段首+7 大端 u16；
 *  - WebP：VP8 关键帧（同步 9D 01 2A @23——14 位宽 @26/高 @28）或 VP8L
 *    （签名 0x2F @20 + 28 位打包 @21：各 14 位存 w-1/h-1）或 VP8X 画布
 *    （u24LE 存 w-1 @24 / h-1 @27）。
 */
function parseDimensions(bytes: Uint8Array, family: SniffFamily): { width: number; height: number } | undefined {
  const u16be = (offset: number): number => (bytes[offset]! << 8) | bytes[offset + 1]!;
  const u16le = (offset: number): number => bytes[offset]! | (bytes[offset + 1]! << 8);
  const u32be = (offset: number): number =>
    ((bytes[offset]! * 0x100 + bytes[offset + 1]!) * 0x100 + bytes[offset + 2]!) * 0x100 + bytes[offset + 3]!;
  switch (family) {
    case 'png': {
      if (bytes.length < 24) return undefined;
      return { width: u32be(16), height: u32be(20) };
    }
    case 'gif': {
      if (bytes.length < 10) return undefined;
      return { width: u16le(6), height: u16le(8) };
    }
    case 'jpeg': {
      // 段扫描：偏移 2 起（SOI 后），每段 FF + 段码 + 大端 u16 段长（含长度
      // 自身两字节）；SOF 族命中取宽高，SOS（扫描数据起点）前未见 SOF =
      // 数据不完整。无段长的独立段（RST/TEM）本路径不可达（正常 JPEG 头
      // 段序），防御位跳过；marker 前 0xFF fill 填充字节（T.81 允许）逐字节
      // 消费（挖掘 14 轮 P2-c）
      let offset = 2;
      while (offset + 4 <= bytes.length) {
        if (bytes[offset] !== 0xff) return undefined; // 段序错乱——不完整
        const marker = bytes[offset + 1]!;
        if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
          offset += 2; // 独立段（无长度字段）——防御跳过
          continue;
        }
        if (marker === 0xff) {
          offset += 1; // fill 填充字节（T.81 允许 marker 前任意数 0xFF）——逐字节
          // 消费，不得误把 fill 后真 marker 字节读成段长跳飞（挖掘 14 轮 P2-c：
          // 部分相机/扫描仪产出带 fill 垫形，曾误报「数据不完整」拒）
          continue;
        }
        const length = u16be(offset + 2);
        if (length < 2) return undefined; // 段长至少含自身两字节——坏形
        const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
        if (isSof) {
          if (offset + 9 > bytes.length) return undefined; // SOF 头截断
          return { height: u16be(offset + 5), width: u16be(offset + 7) };
        }
        if (marker === 0xda) return undefined; // 到扫描数据仍未见 SOF
        offset += 2 + length;
      }
      return undefined;
    }
    case 'webp': {
      if (bytes.length < 30) return undefined;
      const chunk = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
      if (chunk === 'VP8 ') {
        // 有损关键帧：三字节帧标签 @20 后同步码 9D 01 2A @23；宽高 14 位
        // 小端 @26/@28（高位两位为缩放标志——掩 0x3FFF）
        if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) {
          return undefined;
        }
        return { width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff };
      }
      if (chunk === 'VP8L') {
        // 无损：签名 0x2F @20 + 四字节小端打包 @21——低 14 位 w-1、次 14 位 h-1
        if (bytes[20] !== 0x2f) return undefined;
        const packed = bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | (bytes[24]! * 0x1000000);
        return { width: (packed & 0x3fff) + 1, height: ((packed >> 14) & 0x3fff) + 1 };
      }
      if (chunk === 'VP8X') {
        // 扩展格式画布：flags @20 + 保留三字节 + u24LE 存 w-1 @24 / h-1 @27
        const w1 = bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16);
        const h1 = bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16);
        return { width: w1 + 1, height: h1 + 1 };
      }
      return undefined; // 其余块形（ANMP 等）不承载画布头——不完整
    }
  }
}

/* ---------------- 受理链真身 ---------------- */

/**
 * 粘贴图受理链（03 §10.4 ②）：images 非空时按钉死链序逐件校验 + 内容寻址
 * 落盘铸 image-ref 引用块族。
 *
 * 拒 = throw AttachmentIntakeRejectionError（status 400 + 五族文案）；附件库
 * 写失败（fs 系统错误）原样上抛不包不吞（fail-loud 受理 500 轨）。空数组
 * 早退零副作用（images 缺席 = 受理链整体短路——既有提交流零漂移，能力面
 * 不可达）。
 */
export function admitPasteImages(input: {
  readonly sessionId: string;
  readonly images: readonly PasteImageInput[];
  readonly store: AttachmentStore | undefined;
  readonly capability: IntakeCapabilityFace;
}): ImageRefContent[] {
  // 空数组早退：先于能力门/存储面（零漂移护栏——测试注入抛错能力面证序）
  if (input.images.length === 0) return [];

  // —— 能力门（链首——模型目录 input 声明判据；缺声明不拦）——
  const modelId = input.capability.modelOf(input.sessionId);
  const modelInfo = input.capability.modelInfoOf(modelId);
  if (modelInfo !== undefined && !modelInfo.input.includes('image')) {
    throw new AttachmentIntakeRejectionError(REJECT_MODEL_INPUT);
  }

  // —— 数量帽（能力门后——无谓逐件解码的省流序）——
  if (input.images.length > ATTACHMENT_INTAKE_MAX_IMAGES) {
    throw new AttachmentIntakeRejectionError(rejectCount());
  }

  // —— 存储面在场性（内存模式数据目录缺席——不臆造存储）——
  if (input.store === undefined) {
    throw new AttachmentIntakeRejectionError(REJECT_NO_STORE);
  }

  // —— 逐件管线（链序：解码 → 字节帽 → 魔数 → MIME 核验 → 尺寸帽 → 落盘）——
  const blocks: ImageRefContent[] = [];
  for (let i = 0; i < input.images.length; i++) {
    const item = input.images[i]!;
    const ordinal = i + 1; // 用户面序号一基

    // base64 严格解码：词法 + 长度对齐（%4===0——标准带填充形）；Node 解码
    // 宽容（忽略非法字符），词法先验拦住静默丢字符形
    if (typeof item.data !== 'string' || !BASE64_STRICT_RE.test(item.data) || item.data.length % 4 !== 0) {
      throw new AttachmentIntakeRejectionError(rejectBase64(ordinal));
    }
    const bytes = Buffer.from(item.data, 'base64');

    // 字节帽（解码后字节——帽先于嗅探，超帽大件不进头解析）
    if (bytes.byteLength > ATTACHMENT_INTAKE_MAX_BYTES) {
      throw new AttachmentIntakeRejectionError(rejectBytes(ordinal));
    }

    // 魔数嗅探四族白名单（SVG 结构性禁入落此拒）
    const family = sniffFamily(bytes);
    if (family === undefined) {
      throw new AttachmentIntakeRejectionError(rejectFormat(ordinal));
    }

    // 声明 MIME 核验：与嗅探族单源映射比对（trim + 小写归一后严格等——
    // image/jpg 别名形不认，声明与内容不符即拒）
    const declared = typeof item.mimeType === 'string' ? item.mimeType.trim().toLowerCase() : '';
    if (declared !== ATTACHMENT_MIME_BY_EXT[family]) {
      throw new AttachmentIntakeRejectionError(rejectMimeMismatch(ordinal));
    }

    // 尺寸帽（零依赖头解析——解压炸弹防线；族内头不完整归格式族）
    const dimensions = parseDimensions(bytes, family);
    if (dimensions === undefined) {
      throw new AttachmentIntakeRejectionError(rejectTruncated(ordinal));
    }
    if (dimensions.width > ATTACHMENT_INTAKE_MAX_DIMENSION || dimensions.height > ATTACHMENT_INTAKE_MAX_DIMENSION) {
      throw new AttachmentIntakeRejectionError(rejectDimension(ordinal));
    }

    // sha256 内容寻址幂等落盘（ext 由嗅探族派生——白名单纵深执法在附件库）；
    // 写失败原样上抛（fail-loud——前序件已写文件为内容寻址非破坏性残留）
    const written = input.store.write(bytes, EXT_BY_FAMILY[family]);

    // 铸引用块（mimeType 取嗅探族单源映射——与声明已核验等值）
    blocks.push({
      type: 'image-ref',
      ref: written.ref,
      mimeType: ATTACHMENT_MIME_BY_EXT[family],
      bytes: bytes.byteLength,
    });
  }
  return blocks;
}

/* ---------------- 再水化（convertToLlm 单点消费位） ---------------- */

/** 文件缺席/读失败降级占位（呈现语义不保像素——03 §10.4 ⑤） */
const IMAGE_UNAVAILABLE_PLACEHOLDER = '[图片已不可用]';

/**
 * image-ref 再水化（03 §10.4 ⑤ 单点——convertToLlm 消费位）：user 消息块
 * 数组中的引用块读附件库还原 ImageContent base64；文件缺席（store 缺席/
 * 文件不在场/ref 坏形 throw）降「[图片已不可用]」文本占位——呈现位降级
 * 不炸 run（再水化是瞬态请求组装面，不落 durable）。无引用块消息恒等直返
 * （零分配零漂移）；assistant/toolResult 消息结构性无引用块，同样恒等。
 */
export function rehydrateImageRefsForLlm(message: Message, store: AttachmentStore | undefined): Message {
  // 快路径一：仅 user 块数组腿有引用块（工具结果 content 无 image-ref 成员）
  if (message.role !== 'user' || typeof message.content === 'string') return message;
  // 快路径二：无引用块零分配直返（绝大多数消息零开销）
  if (!message.content.some((block) => (block.type as string) === 'image-ref')) return message;

  const out: (TextContent | ImageContent)[] = [];
  for (const block of message.content) {
    if ((block.type as string) !== 'image-ref') {
      // 非引用块原样保序（text/内联 image——ContentBlock 联合扩形挂主会话
      // 收口批，as string 旁路判别同 session-export 先例）
      out.push(block as TextContent | ImageContent);
      continue;
    }
    const refBlock = block as unknown as ImageRefContent;
    // 读失败全谱降占位：文件缺席（null）/ref 坏形（throw）/store 缺席——
    // 图片不可用是同一事实，run 不因附件面故障中断
    let record: { bytes: Uint8Array; mimeType: string } | null = null;
    try {
      record = store !== undefined ? store.read(refBlock.ref) : null;
    } catch {
      record = null;
    }
    out.push(
      record !== null
        ? // 还原 base64 内联（mimeType 取附件库单源派生——与受理时核验值同源）
          { type: 'image', data: Buffer.from(record.bytes).toString('base64'), mimeType: record.mimeType }
        : { type: 'text', text: IMAGE_UNAVAILABLE_PLACEHOLDER },
    );
  }
  return { ...message, content: out } as Message;
}
