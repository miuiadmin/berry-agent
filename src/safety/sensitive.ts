/**
 * L3 safety — 敏感件读集单源（04 §7 读侧 carve-out + 03 §10.9 凭证代管 + 04 §9 allowlist）。
 *
 * SENSITIVE_READ_BASENAMES = dataDir 直下「恒不可读」件名的唯一字面源，消费
 * 面 = fs 工具族读脸（装配层注入 tools）与沙箱 profile 读 deny（confine
 * enrich）两条执法腿的同源数据。
 *
 * 对拍锚（字面镜像）：persist/secret-box.ts 的 SECRET_KEY_BASENAME 与
 * host/tool-policy-store.ts 的 TOOL_POLICY_BASENAME。safety 不 import
 * persist/host（DAG 边表——与 gate.dataDir 必填注入同律），字面同步由对拍
 * 测试互证（漂移即红）。
 */

import { join } from 'node:path';
import { canonicalPath } from './roots.js';

/**
 * 敏感件 basename 集（canonical dataDir 直下）。
 * - secret.key：会话密钥（03 §10.9 / persist secret-box——密文与凭据的根钥）；
 * - tool-policy.json：策略表面（04 §9——免问/拒绝条目本体泄出即审批面测绘；
 *   2026-09-11 审批分档批更名，原 allowlist.json）；
 * - allowlist.json：旧载体名留置保护（更名批共存序「旧文件留置不删」——
 *   旧文件在数据目录滞留期间同不可读，防升格遗存读敞门）。
 * canonical 派生不可省：literal deny（seatbelt）与 ro-bind 遮蔽（bwrap）
 * 都必须落在符号链解析后的真实路径上才生效（/tmp → /private/tmp 字面
 * miss——2026-09-08 实机核验定形）。
 */
export const SENSITIVE_READ_BASENAMES: readonly string[] = ['secret.key', 'tool-policy.json', 'allowlist.json'];

/**
 * 敏感件 canonical 绝对路径集（路径判与 inode 判的比对基准；沙箱读 deny 行
 * 的数据源）。逐件 canonical 派生而非整目录——canonicalPath(dataDir) 目录
 * 存在时两者等价，目录缺席（首启未建）时逐件回退最近在场祖先仍稳定。
 */
export function sensitiveReadFiles(dataDir: string): readonly string[] {
  return SENSITIVE_READ_BASENAMES.map((name) => canonicalPath(join(dataDir, name)));
}
