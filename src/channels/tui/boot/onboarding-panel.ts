/**
 * 启动引导面板件（07 §4.1 呈现面件 11——onboarding 立题批 ob-2 双层制第一层）。
 *
 * boot ready 后、TUI 主屏起屏前的 cooked 窗一次性引导（模型凭证
 * unconfigured 才进；可跳过——非硬闸，与 codex 硬闸形分立）。渲染载体 =
 * cooked 窗直写（BootAnimation 件 10 同族——纯文本行，不占副屏引擎、不进
 * 1049）；单键读 = raw 窗一键（io.onInput + setRawMode 产线真身在装配位
 * tui-entry——本件收抽象 readKey，纯逻辑可测）。
 *
 * - 双层制第一层（第二层 = 运行首触既有 ✖ 指路块——recovery enrich 零新增）；
 * - 与首启欢迎（07 §8.5 第 4 条）分职不互替：面板进主屏前、欢迎块进主屏后
 *   ——双态双发不合并；
 * - /setup 选项降级缺席律：向导命令不在场（ob-3 落地前单发窗）→ 两选项形
 *   （enter 跳过 / q 退出），在场 → 三选项形（enter 向导 / s 跳过 / q 退出）；
 * - 态可入面、值与凭证恒不入面（/status 凭证态行同律）；
 * - 检测恒派生态现算（面板判定在装配位 modelCredentialStatus——本件收结果
 *   不查源，credentials/changed seam 订阅不设）。
 */

/** 面板决策（装配位消费：quit = 不起 TUI 干净退 0；setup = 起屏后即开向导；skip = 直进主屏） */
export type OnboardingDecision = 'setup' | 'skip' | 'quit';

/** 面板材料（装配位现算注入——本件零边外面） */
export interface OnboardingPanelOptions {
  /** 行写出面（cooked 窗直写——BootAnimation 同形） */
  readonly write: (text: string) => void;
  /** 单键读（键面 = normalizeOnboardingKey 归一产物；未识别键由本件循环再读） */
  readonly readKey: () => Promise<string>;
  /** /setup 向导在场位（装配位探 localCommands——降级缺席律执法位在装配） */
  readonly hasSetupWizard: boolean;
  /** 当前模型标识（态材料——面板点名） */
  readonly modelSpec: string;
  /** provider 名（斜杠首段——供血目标点名） */
  readonly providerId: string;
  /** env 例键（providerApiKeyEnvNames 首键——缺席 = env 途径句降，凭证表途径恒在） */
  readonly envExample?: string;
}

/**
 * 面板行集构造（纯函数——测试直锁）：告警头（态可入面）→ 双途径指路
 * （env 例键在场三行 / 缺席两行——序号随行重排）→ 选项块（全形三行 /
 * 降级形两行）。
 */
export function buildOnboardingLines(o: OnboardingPanelOptions): string[] {
  const lines: string[] = [
    '⚠ 模型凭证未配置——发消息将失败',
    `  当前模型 ${o.modelSpec}（provider ${o.providerId}）无可用凭证。`,
    '',
    '  配置途径（任选其一）：',
  ];
  const afterEnv = o.envExample !== undefined ? 2 : 1;
  if (o.envExample !== undefined) {
    lines.push(`  1. 环境变量（如 ${o.envExample}）——设后重启生效`);
  }
  lines.push(
    `  ${afterEnv}. 凭证表绑定行（录入即生效，无需重启）：/credentials add <名> <值> --model-provider ${o.providerId}`,
    '',
  );
  if (o.hasSetupWizard) {
    lines.push(
      '  [enter] 进入 /setup 配置向导（选 provider → 录 key → 落绑定行）',
      '  [s]     跳过，进入主屏（可稍后 /setup 或 /credentials）',
      '  [q]     退出',
    );
  } else {
    lines.push('  [enter] 进入主屏（可稍后 /credentials add 录入或 /guide 查配置）', '  [q]     退出');
  }
  return lines;
}

/**
 * 原始键序归一（单键面——产线真身 readSingleKey 的判据单源）：\r/\n→enter、
 * 单发 \x1b→escape（转义序列不冒充 esc）、\x03→ctrl+c、s/q 大小写归小、
 * 余键 unknown（含整段首键外的多键粘贴——面板无回显位静默再读）。
 */
export function normalizeOnboardingKey(data: string): string {
  const first = data[0] ?? '';
  if (first === '\r' || first === '\n') return 'enter';
  if (first === '\x1b') return data.length > 1 ? 'unknown' : 'escape';
  if (data === '\x03') return 'ctrl+c';
  if (data.length === 1 && (data === 's' || data === 'q')) return data;
  if (data.length === 1 && (data === 'S' || data === 'Q')) return data.toLowerCase();
  return 'unknown';
}

/**
 * 面板主循环：写出行集后循环读键至合法决策（ctrl+c/esc/q = quit——面板期
 * 退出即整进程退出，无主屏可回；enter = 全形 setup / 降级形 skip；s = skip
 * 两形同收——键词汇单源（降级形行集只广而告之 enter/q，s 不另立拒面））。
 * 未识别键静默再读（面板无输入回显位、行集不重绘）。
 */
export async function runOnboardingPanel(o: OnboardingPanelOptions): Promise<OnboardingDecision> {
  o.write(`${buildOnboardingLines(o).join('\n')}\n`);
  for (;;) {
    const key = await o.readKey();
    if (key === 'q' || key === 'escape' || key === 'ctrl+c') return 'quit';
    if (key === 'enter') return o.hasSetupWizard ? 'setup' : 'skip';
    if (key === 's') return 'skip';
  }
}
