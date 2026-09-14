/**
 * L3 safety — 敏感件读集单源（04 §7 读侧 carve-out + 03 §10.9 凭证代管 + 04 §9 allowlist）。
 *
 * SENSITIVE_READ_DATA_PATHS = dataDir 相对路径「恒不可读」件的唯一字面源，消费
 * 面 = fs 工具族读脸（装配层注入 tools）与沙箱 profile 读 deny（confine
 * enrich）两条执法腿的同源数据。集员自「直下 basename」扩为「dataDir 相对
 * 路径」（2026-09-14 五役 CL-1——04 §7 定形注：闭集四员、成员含子路径，
 * canonicalPath(join(dataDir, <成员>)) 对五消费位零改动兼容）。
 *
 * 对拍锚（字面镜像）：persist/secret-box.ts 的 SECRET_KEY_BASENAME 与
 * host/tool-policy-store.ts 的 TOOL_POLICY_BASENAME。safety 不 import
 * persist/host（DAG 边表——与 gate.dataDir 必填注入同律），字面同步由对拍
 * 测试互证（漂移即红）。
 */

import { join } from 'node:path';
import { canonicalPath } from './roots.js';

/**
 * 敏感件 dataDir 相对路径集（canonical dataDir 为基——04 §7 敏感件集闭集）。
 * - secret.key：会话密钥（03 §10.9 / persist secret-box——密文与凭据的根钥）；
 * - tool-policy.json：策略表面（04 §9——免问/拒绝条目本体泄出即审批面测绘；
 *   2026-09-11 审批分档批更名，原 allowlist.json）；
 * - allowlist.json：旧载体名留置保护（更名批共存序「旧文件留置不删」——
 *   旧文件在数据目录滞留期间同不可读，防升格遗存读敞门）；
 * - serve/daemon.log：daemon 形自动生成 SDK token 的明文披露位（03 §10.6
 *   差异面⑤——serve-daemon stderr 落该日志；2026-09-14 五役 CL-1 入集：模型
 *   读它无正用途只有取凭证一途，issue 会话 bash cat 即读，读集缺席即
 *   「读凭证 → 公开外泄」链的现成读腿——04 §7 五役笔）。**子路径成员**：
 *   相对 dataDir 的 serve/ 下孙件，非直下 basename（数组名随之自
 *   SENSITIVE_READ_BASENAMES 勘正）。
 * canonical 派生不可省：literal deny（seatbelt）与 ro-bind 遮蔽（bwrap）
 * 都必须落在符号链解析后的真实路径上才生效（/tmp → /private/tmp 字面
 * miss——2026-09-08 实机核验定形）。
 */
export const SENSITIVE_READ_DATA_PATHS: readonly string[] = [
  'secret.key',
  'tool-policy.json',
  'allowlist.json',
  'serve/daemon.log',
];

/**
 * 敏感件 canonical 绝对路径集（路径判与 inode 判的比对基准；沙箱读 deny 行
 * 的数据源）。逐件 canonical 派生而非整目录——canonicalPath(dataDir) 目录
 * 存在时两者等价，目录缺席（首启未建）时逐件回退最近在场祖先仍稳定（子路径
 * 员 serve/daemon.log 同律：serve/ 目录未建时祖先回退拼回尾段，不虚构路径）。
 */
export function sensitiveReadFiles(dataDir: string): readonly string[] {
  return SENSITIVE_READ_DATA_PATHS.map((name) => canonicalPath(join(dataDir, name)));
}
