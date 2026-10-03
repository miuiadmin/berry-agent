/**
 * 启动动画件（07 §4.1 呈现面件 10——三反馈批D 案A cooked 逐行）。
 *
 * 编舞：装配期（先行件2 供数面 onBootStage/onPluginLoadStart——assembly
 * emitBootStage）驱动本件在 cooked 窗逐行写出启动进度——头行一次
 * `berry-agent v<版本>`、阶段完成行 `✓ <阶段呈现词>`、插件装载行
 * `› 装载 <id>（i/N）`（装载前达——次行出现即本件完成）；阶段 start
 * 相位零行（完成行才是可见刻度）。
 *
 * 结构锁（07 :204 进屏序律射程分立——本件写侧自锁）：
 * - **零 CSI/OSC**：动画窗纯文本字节域（`\n` 结尾、ONLCR 交驱动）——无
 *   色彩 SGR 无光标控制，probe 类写出的 raw 前序问题在射程外（本件非探测）；
 * - **启动行保活**（界面美化役 2026-10-01）：ready 收尾行写出后追加等量
 *   已发行数的纯换行——把启动进度行推入 scrollback（主屏起屏 ED(2) 只清
 *   可见屏、主屏无 1049 行内形——行物理留存交滚回可查）；锚在 ready 相位
 *   = 成功路专属，失败路启动行原地留存；
 * - **阶段行不虚报律**：只呈现真实阶段事件（拍板 #11——不造「连接模型」
 *   等伪行），未识阶段 id fail-open 直用（词汇表前瞻兼容）；
 * - **动画行零 ms**：行到达间隔即耗时显示（值非确定性面不进呈现道）；
 * - **stderr 启动打点件**（pi PI_TIMING 抄形）：BERRY_AGENT_TIMING=1 门，
 *   段记账（任一事件达即结算前段——开段者标签记账）+ finish 汇总
 *   `--- 启动计时 ---` 段行 + `TOTAL`——诊断道与呈现道分立；
 * - **fail-open 双保**：assembly 层 emitBootStage try/catch 之外，本件
 *   各入口自 try/catch 吞写出面异常——动画永不炸装配路。
 *
 * DAG 注：阶段标识/相位为本地宽面 string（先行件2 HostBootStage 的呈现侧
 * 镜像）——不 import host 件，host→channels 单向不破；接线位（tui-entry）
 * 负责事件字段适配。
 */

/** 阶段呈现词表（词汇单源——先行件2 六阶段 id 的呈现面镜像） */
const STAGE_WORDS: Readonly<Record<string, string>> = {
  runtime: '运行时',
  stack: '会话栈',
  plugins: '插件',
  skills: '技能',
  subagents: '子代理域',
  ready: '就绪',
};

/** plugins 阶段尾 detail 解析形（先行件2 约定——enabled=N,total=M） */
const PLUGIN_COUNT_SHAPE = /^enabled=(\d+),total=(\d+)$/;

/** 控制字节剥除（写侧防御——id 溢控制字节不透传终端；ESC 序列形被拆为纯文本） */
function stripControl(text: string): string {
  // C0 全域（含 ESC/BEL/CR）+ DEL——id 面单行呈现无换行语义（\n 不在此面）
  return text.replace(/[\u0000-\u001f\u007f]/g, '');
}

/** 阶段相位（'start' 开段 / 'end' 完成行） */
export type BootStagePhase = 'start' | 'end';

/** 注入面：写出/钟源/打点门全可注（测试确定性——真身 = io / Date.now / stderr） */
export interface BootAnimationOptions {
  /** 版本串（头行 `berry-agent v<version>`；缺省 '0.0.0'） */
  readonly version?: string;
  /** 钟源（缺省 Date.now——段计时确定性注入位） */
  readonly now?: () => number;
  /** stderr 写出面（打点件汇总落点；缺省 process.stderr.write） */
  readonly stderr?: (text: string) => void;
  /** 打点门（缺省 false——接线位按 BERRY_AGENT_TIMING=1 开） */
  readonly timingEnabled?: boolean;
}

/** 已结算段账（打点件面——门关也零成本记账） */
interface TimingSegment {
  readonly label: string;
  readonly ms: number;
}

/** 启动动画：装配期 cooked 窗逐行呈现 + 可选 stderr 段计时汇总 */
export class BootAnimation {
  private readonly write: (text: string) => void;
  private readonly version: string;
  private readonly now: () => number;
  private readonly stderr: (text: string) => void;
  private readonly timingEnabled: boolean;
  /** 头行已出（首事件触发——恰一次） */
  private started = false;
  /** 收尾已过（finish 幂等 + 收尾后事件零消费） */
  private finished = false;
  /**
   * 已发行数（启动行保活计数——界面美化役 2026-10-01）：主屏起屏 ED(2)
   * 只清可见屏不清 scrollback，等量换行把启动进度行推入 scrollback 后即
   * 交滚回可查（进度一闪即空的治面）。
   */
  private emittedLines = 0;
  /** 开放段：起点时戳 + 记账标签（任一事件达即结算前段） */
  private openSince: number | null = null;
  private openLabel = '';
  private readonly segments: TimingSegment[] = [];

  constructor(write: (text: string) => void, options: BootAnimationOptions = {}) {
    this.write = write;
    this.version = options.version ?? '0.0.0';
    this.now = options.now ?? Date.now;
    this.stderr = options.stderr ?? ((text) => process.stderr.write(text));
    this.timingEnabled = options.timingEnabled === true;
  }

  /** 结算开放段（无开放段 = no-op——事件序空洞容错） */
  private closeOpen(): void {
    if (this.openSince === null) return;
    this.segments.push({ label: this.openLabel, ms: this.now() - this.openSince });
    this.openSince = null;
    this.openLabel = '';
  }

  /** 开新段（前段先结算——段序即事件序） */
  private openSegment(label: string): void {
    this.closeOpen();
    this.openSince = this.now();
    this.openLabel = label;
  }

  /** 头行恰一次（首事件触发——之后全阶段共享已开窗） */
  private ensureHeader(): void {
    if (this.started) return;
    this.started = true;
    this.writeLine(`berry-agent v${this.version}`);
  }

  /** 单行写出（统一 `\n` 结尾 + 行数记账——启动行保活计数的单源写位） */
  private writeLine(text: string): void {
    this.write(`${text}\n`);
    this.emittedLines++;
  }

  /**
   * 启动行推入 scrollback（ready 相位收尾时——界面美化役 2026-10-01）：
   * 等量已发行数的纯换行把全部启动进度行推出可见屏进 scrollback，主屏
   * 起屏 ED(2) 只清可见屏（主屏无 1049——行内形），启动行物理留存交滚回
   * 可查。锚在 ready 相位 = **成功路专属**（assembly ok:true 返回点前恰
   * 一次到达），失败路启动行原地留存于错误呈报上方不受影响。
   */
  private pushLinesIntoScrollback(): void {
    if (this.emittedLines <= 0) return;
    this.write('\n'.repeat(this.emittedLines));
  }

  /**
   * 阶段事件（先行件2 onBootStage 的呈现消费位）。
   * start = 开段零行；end = 完成行（plugins 尾 detail 计数形优先，失配
   * 回退裸完成行）；ready 只发 end 且不开不结段（瞬时相位）。
   */
  stage(stage: string, phase: BootStagePhase, detail?: string): void {
    try {
      if (this.finished) return;
      this.ensureHeader();
      // 未识 id fail-open 直用（词汇表前瞻兼容）；fallback 词过控制字节剥除
      // （全域清扫 #4 对称补——pluginLoad 防御律同源，id 溢控制字节不透传终端）
      const word = STAGE_WORDS[stage] ?? stripControl(stage);
      if (phase === 'start') {
        this.openSegment(word);
        return;
      }
      if (stage !== 'ready') this.closeOpen();
      if (stage === 'plugins' && detail !== undefined) {
        const parsed = PLUGIN_COUNT_SHAPE.exec(detail);
        if (parsed !== null) {
          this.writeLine(`✓ ${word}（启用 ${parsed[1]}/共 ${parsed[2]}）`);
          return;
        }
      }
      this.writeLine(`✓ ${word}`);
      // 启动行保活：ready 是末条启动进度行——写完即推入 scrollback（成功路
      // 专属相位，见 pushLinesIntoScrollback 注）
      if (stage === 'ready') this.pushLinesIntoScrollback();
    } catch {
      // 呈现件自保——写出面异常不外炸装配路（fail-open 双保呈现侧兜底）
    }
  }

  /**
   * 插件装载事件（先行件2 onPluginLoadStart 的呈现消费位——装载前达，
   * 次行出现即本件完成）。开段标签 `插件 <id>`（段账粒度 = 逐件装载）。
   */
  pluginLoad(pluginId: string, index: number, total: number): void {
    try {
      if (this.finished) return;
      this.ensureHeader();
      const id = stripControl(pluginId);
      this.openSegment(`插件 ${id}`);
      // 装载行前缀 › 与 panel-chrome CURSOR_MARK 同字形但语境分立：本符号是
      // 「插件装载引导行」记号非「输入/选中位」光标符（注⑩ 符号册语义位）；
      // 本件结构锁零依赖纯文本字节域（不引渲染树件），故保字面量——字形若
      // 随符号册翻档，此处同源手翻
      this.writeLine(`› 加载 ${id}（${index}/${total}）`);
    } catch {
      // 呈现件自保（同上）
    }
  }

  /**
   * 收尾（接线位在装配返回点调用——成功/失败两路单点；幂等）。
   * 悬段收口入账 + 打点门开时汇总段行与 TOTAL 至 stderr。
   */
  finish(): void {
    try {
      if (this.finished) return;
      this.finished = true;
      this.closeOpen(); // 失败路中途段也入账（诚实计账不丢面）
      if (!this.timingEnabled || this.segments.length === 0) return;
      let total = 0;
      const lines: string[] = ['--- 启动计时 ---\n'];
      for (const segment of this.segments) {
        total += segment.ms;
        lines.push(`  ${segment.label}: ${segment.ms}ms\n`);
      }
      lines.push(`  TOTAL: ${total}ms\n`);
      this.stderr(lines.join(''));
    } catch {
      // 呈现件自保（收尾不因写出面炸装配路）
    }
  }
}
