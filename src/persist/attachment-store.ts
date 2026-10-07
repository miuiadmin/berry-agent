/**
 * persist — 附件库读写面（03 篇 §10.4 ③ 2026-10-08 剪贴板附件批条款；
 * 05 篇 §1.1 image-ref 行注的存储承载位）。
 *
 * 载体定位：sha256 内容寻址文件旁路——零新表零迁移（存储选型拍板；
 * zcode/opencode 判例）。落盘形 `<dataDir>/attachments/<sha256>.<ext>`
 * （ext 由受理链魔数嗅探族派生——嗅探不在本面，白名单执法仅为纵深）；
 * 跨会话共享（内容寻址本征：同图多会话引用同文件，单人本机语义）；
 * 会话删除编排不级联删附件（孤儿治理另册挂账——03 §10.4 ⑧）。
 *
 * 两方法窄面（单写者 = 宿主装配根受理链桥真身；webui 件 deps 无 persist
 * 边——词面独立律，经 host 装配桥接线）：
 *  - write 写幂等：sha256(bytes) → 内容寻址路径落盘；文件在场跳写（同图
 *    重复粘贴同 ref 去重）；返回 `{ref: 'sha256:<hex>', bytes}`。
 *  - read 读回：ref 先验正则 `^sha256:[0-9a-f]{64}$`；从 ref 提 hex +
 *    遍历 ext 白名单定位文件；命中返回 `{bytes, ext, mimeType}`，缺文件
 *    返回 null。路径穿越结构性不可达：hex 定长小写十六进制字符集 + ext
 *    白名单常量双约束，拼路径零用户输入自由段。
 *
 * 拒形态钉死（调用方分类映射；本模块零新 BaseError 注册码——03 §10.4 ②
 * 「零新码」条款，intake 拒非进程内错误轨）：
 *  - ext 白名单外（write 入参）→ throw Error（文案含「白名单」——受理链
 *    归 400「格式」族）；
 *  - ref 坏形（read 入参）→ throw Error（文案含「格式不正确」——读回端点
 *    归 400，03 §10.4 ④「ref 坏形 400」）；
 *  - 缺文件 → null（读回端点 404 轨——与坏形 400 分立）；
 *  - 写失败（fs 系统错误）→ 原样上抛不包不吞（受理 500 fail-loud——
 *    secret-box 原样上抛形；boot-failures 吞降级防线不适用受理位）。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 嗅探族派生 ext 白名单（03 §10.4 ②——PNG/JPEG/GIF/WebP 四族；SVG 结构性
 * 禁入）。序即读回遍历序：首命中即返（内容寻址下同 hex 双 ext 在场系嗅探
 * 分歧病态形，实际不可达——嗅探在受理链单源派生）。
 */
export const ATTACHMENT_EXT_WHITELIST = ['png', 'jpeg', 'gif', 'webp'] as const;

/** ext 类型（白名单字面量联合——TS 调用方编译期收窄，运行时白名单执法纵深） */
export type AttachmentExt = (typeof ATTACHMENT_EXT_WHITELIST)[number];

/**
 * ext→MIME 单源映射（03 §10.4 ④——读回端点 Content-Type 派生源，波3 消费
 * 位复用；受理链声明 MIME 一致性校验同源消费）。键值形钉死：白名单四族
 * 恰一行，增族须两处（白名单 + 本映射）同笔。
 */
export const ATTACHMENT_MIME_BY_EXT: Readonly<Record<AttachmentExt, string>> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

/** ref 词法正则——`sha256:` 前缀 + 64 位小写十六进制（大写拒：词法单源小写） */
const ATTACHMENT_REF_RE = /^sha256:[0-9a-f]{64}$/;

/** 附件库目录名（数据目录下旁路位——与 sessions.db 同级） */
const ATTACHMENTS_DIR_BASENAME = 'attachments';

/** write 回执（受理链铸 image-ref 引用块的供源形） */
export interface AttachmentWriteResult {
  /** 内容寻址引用 `sha256:<hex>`（事件流 image-ref 块 ref 位同形） */
  readonly ref: string;
  /** 字节数（入参原始字节长度——引用块 bytes 位供源） */
  readonly bytes: number;
}

/** read 命中回执 */
export interface AttachmentRecord {
  /** 原始字节（读回端点应答体 / 再水化 base64 供源） */
  readonly bytes: Buffer;
  /** 命中文件的嗅探族 ext（白名单成员） */
  readonly ext: AttachmentExt;
  /** MIME（ATTACHMENT_MIME_BY_EXT 单源派生） */
  readonly mimeType: string;
}

/** 附件库读写两方法窄面（createAttachmentStore 构造；dataDir 注入形） */
export interface AttachmentStore {
  /**
   * 幂等写：sha256 内容寻址落盘 `<dataDir>/attachments/<hex>.<ext>`；文件
   * 已在场跳写（同字节两写同 ref）。ext 白名单外 throw Error（拒形态见
   * 模块头注）；fs 写失败原样上抛（fail-loud）。
   */
  write(bytes: Uint8Array, ext: AttachmentExt): AttachmentWriteResult;
  /**
   * 按 ref 读回：坏形 throw Error（拒形态见模块头注）；遍历白名单 ext 定
   * 位文件，命中返回 `{bytes, ext, mimeType}`；遍历无命中（含目录不在场）
   * 返回 null。读失败（权限等非缺席系统错误）原样上抛。
   */
  read(ref: string): AttachmentRecord | null;
}

/**
 * 构造附件库读写面。
 * @param dataDir 数据目录（宿主装配根注入——resolveDataDir 梯子真源在
 *   paths.ts；本面不解析 env，构造期零 fs 副作用——attachments 目录由
 *   首笔 write 幂等建就）
 */
export function createAttachmentStore(dataDir: string): AttachmentStore {
  // 附件库目录（数据目录旁路位——构造期零 fs 副作用，首笔 write 幂等建就）
  const attachmentsDir = join(dataDir, ATTACHMENTS_DIR_BASENAME);
  // 白名单成员集（运行时执法用——Set.has 判据；TS 字面量联合在 JS 调用方
  // 绕过类型面时由此闸收口）
  const extSet: ReadonlySet<string> = new Set(ATTACHMENT_EXT_WHITELIST);

  return {
    write(bytes, ext) {
      // 纵深执法：ext 白名单外拒（嗅探在受理链 03 §10.4 ②——此处再执法，
      // JS 调用方绕过类型面时的运行时闸；SVG 结构性禁入即落此拒）
      if (!extSet.has(ext)) {
        throw new Error(`附件扩展名不在白名单：${String(ext)}`);
      }
      // sha256 内容寻址：hex 恒小写（digest 产出即小写——ref 词法正则同源）
      const hex = createHash('sha256').update(bytes).digest('hex');
      const target = join(attachmentsDir, `${hex}.${ext}`);
      // 幂等跳写：在场即返（内容寻址信任在场文件——同图重复粘贴同 ref；
      // 断电半写窗由落盘 temp+rename 收口，见下）
      if (existsSync(target)) return { ref: `sha256:${hex}`, bytes: bytes.byteLength };
      // 目录建链幂等（recursive——多级缺省建就；被同名文件占位等系统错误
      // 原样上抛——fail-loud 受理 500 轨）
      mkdirSync(attachmentsDir, { recursive: true });
      // temp+rename 原子落盘：幂等跳写会永续信任在场文件，半写残卷若直写
      // 终名将永久毒化该内容寻址位——先写同目录 temp 再 rename 收口该窗。
      // 同进程单线程写（单写者 = 宿主装配根）+ 同 hex 恒同字节（sha256），
      // temp 名碰撞也收敛同内容，无需随机后缀
      const tmp = `${target}.tmp`;
      writeFileSync(tmp, bytes);
      renameSync(tmp, target);
      return { ref: `sha256:${hex}`, bytes: bytes.byteLength };
    },

    read(ref) {
      // 词法先于寻位：格式不正确拒（读回端点 400 轨——文案含「格式不正确」
      // 供调用方分类；大写 hex/穿越形/非十六进制全落此拒，拼路径零用户输入自由段）
      if (!ATTACHMENT_REF_RE.test(ref)) {
        throw new Error(`附件引用格式不正确（须为 sha256: 开头加 64 位小写十六进制）：${ref}`);
      }
      const hex = ref.slice('sha256:'.length);
      // 遍历白名单 ext 定位（序即白名单序，首命中即返）；缺文件（含目录
      // 不在场）逐腿 ENOENT 续扫，全 miss → null（404 轨）；非缺席系统
      // 错误（权限等）原样上抛
      for (const ext of ATTACHMENT_EXT_WHITELIST) {
        let raw: Buffer;
        try {
          raw = readFileSync(join(attachmentsDir, `${hex}.${ext}`));
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
          throw err;
        }
        return { bytes: raw, ext, mimeType: ATTACHMENT_MIME_BY_EXT[ext] };
      }
      return null;
    },
  };
}
