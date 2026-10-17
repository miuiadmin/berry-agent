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
 * （§8.2 注入前拦截——批 18c-4）复用本扫描器 + 指令样注入检测，
 * 统一罩住工具读面与注入面。
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

/* ---------------- 读出消毒（06 §8.2——批 18c-4） ---------------- */

/**
 * 指令样注入检测模式（保守清单——起草值随实测调）：只收**针对 AI 的高危
 * 注入句式**（忽略既有指令 / 无视上文 / 角色劫持 / 索要系统提示词——中英
 * 双语）；「必须用 pnpm」一类正常偏好/约定记忆不收（误杀正常知识比漏检
 * 更伤记忆库）。命中不剔除——框架降权为「引述」呈现（§8.2 字面）。
 */
const INJECTION_PATTERNS: readonly RegExp[] = [
  // 忽略既有指令族（中文）
  /忽略(之前|以上|上述|前面|上面)(的)?(所有|全部)?(指令|指示|提示|规则)/,
  /无视(以上|上述|之前|前面|上面)(的)?(任何)?(指令|指示|提示|内容|规则)/,
  /不再遵守(任何|以上|上述)?(指令|指示|规则|约束)/,
  // 忽略既有指令族（英文——小写归一子串语义以 /i 达成）
  /ignore (all )?(previous|prior|above|earlier|preceding) (instructions?|prompts?|rules?|directions?)/i,
  /disregard (all )?(previous|prior|above|earlier|preceding)/i,
  /forget (all )?(previous|prior) (instructions?|prompts?|rules?)/i,
  // 角色劫持族（「你现在是」——记忆内容不该给模型换角色）
  /(你|您)现在(是|扮演)/,
  /从现在开始(你|您)(是|扮演|要)/,
  /you are now (a|an|the) /i,
  /act as if you (are|were)/i,
  // 索要系统提示词族（套话面——记忆内容不该反向打探宿主配置）
  /reveal (your|the) (system prompt|system instructions|hidden instructions)/i,
  /(显示|泄露|输出|告诉我)(你的)?(系统提示词|系统指令|隐藏指令)/,
];

/** 读出消毒判定（§8.2 统一读出消毒函数——同时罩住工具读面与注入面） */
export interface ReadoutVerdict {
  /** secret 命中：注入面整条剔除（frozen 剔除可见计数）/ 工具面遮蔽原文 */
  readonly blocked: boolean;
  /** secret 命中 pattern 名单（说面不说值——诊断纪律同 §8.1） */
  readonly patterns: readonly string[];
  /** 指令样命中：保留但框架降权为「引述」呈现 */
  readonly quoted: boolean;
}

/**
 * 条目读出消毒（06 §8.2——注入前对记忆块跑同一扫描器 + 注入模式检测）：
 * summary 与 content（在场时）各自入检，任一面 secret 命中 → blocked；
 * 任一面指令样命中 → quoted。历史入库（扫描器清单升级前入库）的敏感串
 * 在读出面拦截——写前扫描（§8.1）拒得了新写，拦不住存量。
 */
export function sanitizeEntryForReadout(entry: {
  readonly summary: string;
  readonly content?: string;
}): ReadoutVerdict {
  const hits = [
    ...scanForSecrets(entry.summary),
    ...(entry.content !== undefined ? scanForSecrets(entry.content) : []),
  ];
  const patterns = [...new Set(hits.map((h) => h.pattern))];
  const quoted = INJECTION_PATTERNS.some(
    (re) => re.test(entry.summary) || (entry.content !== undefined && re.test(entry.content)),
  );
  return { blocked: patterns.length > 0, patterns, quoted };
}
