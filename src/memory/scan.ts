/**
 * 写前 secret 扫描件（06 §8.1——Hermes 实证；批 18c-1）。
 *
 * 挂 DAO 入库单点（一切写路径的物理汇入面）：§4 即时路提取（经合并管线）、
 * §4 周期路候选（经合并管线）、memory_write 直写、导入直插**四写点**汇入
 * 同一入库面执法，没有绕过扫描的写入方。
 *
 * 诊断纪律（06 §8.1 字面）：命中即拒写并记一条 log-only 诊断——**不把疑似
 * 密钥再写进日志**：本件只返回 pattern 名（'github-token' 等），命中位信息
 * （条目 summary/content 哪一面）由调用方在诊断里说面不说值。
 *
 * 模式清单 = 保守常量（06 §8.1 起草值随实测调）：全部取**带特征前缀**的
 * 高置信形态，不收裸十六进制/裸 base64 通用形——git commit SHA（40 hex）、
 * 摘要哈希等常见长十六进制串零误报（保守清单的立清单由）。读出消毒
 * （§8.2 注入前拦截）随 18c-4 注入笔复用本扫描器。
 */

/** 扫描命中（pattern 名即诊断面——不携带命中文本本体） */
export interface SecretScanHit {
  /** 模式名（诊断词汇——log-only 面说面不说值） */
  readonly pattern: string;
}

/** 模式清单（保守常量——每条附特征前缀与最小长度，防短串误报） */
const SECRET_PATTERNS: readonly { readonly pattern: string; readonly re: RegExp }[] = [
  // OpenAI / Anthropic 风 api key：sk- 前缀 + ≥20 位（sk-ant-… 同族覆盖）
  { pattern: 'openai-style-key', re: /\bsk-[A-Za-z0-9_-]{20,}/g },
  // GitHub token 族：ghp_/gho_/ghu_/ghs_/ghr_ 前缀 + ≥30 位
  { pattern: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}/g },
  // AWS access key id：AKIA 前缀恰 20 位大写字母数字
  { pattern: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}/g },
  // Google API key：AIza 前缀 + ≥30 位
  { pattern: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{30,}/g },
  // Slack token 族：xox[baprs]- 前缀 + ≥10 位
  { pattern: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g },
  // JWT 三段式：两段 base64url 头载荷 + 签名段（eyJ 开头的头部是高置信指纹）
  { pattern: 'jwt', re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  // PEM 私钥块头（-----BEGIN ... PRIVATE KEY-----）
  { pattern: 'pem-private-key', re: /-----BEGIN[A-Z ]*PRIVATE KEY-----/g },
];

/**
 * 扫描文本是否命中疑似密钥。
 * @param text 受检文本（summary 与 content 各自入检）
 * @returns 命中清单（空数组 = 干净；多重命中逐 pattern 一条——诊断面用）
 */
export function scanForSecrets(text: string): SecretScanHit[] {
  const hits: SecretScanHit[] = [];
  for (const { pattern, re } of SECRET_PATTERNS) {
    // lastIndex 复位（/g 正则跨调用共享 lastIndex——module 级常量须自证无状态）
    re.lastIndex = 0;
    if (re.test(text)) hits.push({ pattern });
  }
  return hits;
}
