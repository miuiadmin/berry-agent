/**
 * 启动引导面板件测试（07 §4.1 呈现面件 11——onboarding 立题批 ob-2 双层制
 * 第一层）：行集构造（两选项降级形/三选项全形——/setup 降级缺席律）+ 键归一
 * + 决策循环（未识别键静默再读）纯逻辑直锁（readKey 注入假源——渲染与流程
 * 解耦，WizardPrompter 抽象先声同族）+ 帧动画段消费（39 池 P4：帧表单源锁
 * 〔同表消费·结构半〕+ wait 行推进/门禁静态/泄漏锁·面板位）。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOOT_FRAME_FAMILIES, GuideFrameAnimation } from './boot-animation.js';
import {
  buildOnboardingLines,
  normalizeOnboardingKey,
  runOnboardingPanel,
  type OnboardingPanelOptions,
} from './onboarding-panel.js';

/** 面板材料基线（各形测试局部覆写） */
const BASE: OnboardingPanelOptions = {
  write: () => {},
  readKey: async () => 'q',
  hasSetupWizard: false,
  modelSpec: 'anthropic/claude-sonnet-5',
  providerId: 'anthropic',
  envExample: 'ANTHROPIC_API_KEY',
};

describe('buildOnboardingLines 行集构造', () => {
  it('降级形（无向导——ob-3 落地前单发窗）：两选项（enter 跳过/q 退出）+ provider 点名 + 双途径指路', () => {
    const text = buildOnboardingLines(BASE).join('\n');
    expect(text).toContain('还没配置 API key');
    expect(text).toContain('anthropic/claude-sonnet-5'); // 模型标识点名
    expect(text).toContain('--model-provider anthropic'); // ob-1 凭证表录入位指路（provider 点名）
    expect(text).toContain('ANTHROPIC_API_KEY'); // env 途径例键
    expect(text).toContain('[enter]'); // 降级形 enter = 跳过
    expect(text).toContain('[q]');
    expect(text).not.toContain('[s]'); // 降级形无 s 选项
    expect(text).not.toContain('/setup'); // 向导缺席不指死路（诚实降级律）
  });

  it('全形（向导在场）：三选项（enter 向导/s 跳过/q 退出）', () => {
    const text = buildOnboardingLines({ ...BASE, hasSetupWizard: true }).join('\n');
    expect(text).toContain('/setup'); // 向导选项在场
    expect(text).toContain('[s]');
    expect(text).toContain('[q]');
  });

  it('env 例键缺席：env 途径句降（不印 undefined 形——providerApiKeyEnvNames 首键缺席的诚实降级）', () => {
    const text = buildOnboardingLines({ ...BASE, envExample: undefined }).join('\n');
    expect(text).not.toContain('undefined');
    expect(text).toContain('--model-provider'); // 凭证表途径恒在
  });
});

describe('normalizeOnboardingKey 键归一', () => {
  it('单键面：\\r/\\n→enter、\\x1b 单发→escape、转义序列→unknown、\\x03→ctrl+c、s/q 大小写归小、余键 unknown', () => {
    expect(normalizeOnboardingKey('\r')).toBe('enter');
    expect(normalizeOnboardingKey('\n')).toBe('enter');
    expect(normalizeOnboardingKey('\x1b')).toBe('escape');
    expect(normalizeOnboardingKey('\x1b[A')).toBe('unknown'); // 方向键转义序列不冒充 esc
    expect(normalizeOnboardingKey('\x03')).toBe('ctrl+c');
    expect(normalizeOnboardingKey('s')).toBe('s');
    expect(normalizeOnboardingKey('S')).toBe('s');
    expect(normalizeOnboardingKey('q')).toBe('q');
    expect(normalizeOnboardingKey('Q')).toBe('q');
    expect(normalizeOnboardingKey('x')).toBe('unknown');
    expect(normalizeOnboardingKey('')).toBe('unknown');
  });
});

describe('runOnboardingPanel 决策循环', () => {
  it('降级形：enter→skip；未识别键静默再读至合法键（行集只写一次不重绘）', async () => {
    const keys = ['x', '\x1b[A', 'enter'];
    const writes: string[] = [];
    const decision = await runOnboardingPanel({
      ...BASE,
      write: (t) => writes.push(t),
      readKey: async () => keys.shift() ?? 'q',
    });
    expect(decision).toBe('skip');
    expect(writes).toHaveLength(1); // 未识别键不重绘（无输入回显位）
  });

  it('全形决策面：enter→setup、s→skip、q/escape/ctrl+c→quit；降级形 enter=skip 不冒充向导', async () => {
    const wizard: OnboardingPanelOptions = { ...BASE, hasSetupWizard: true };
    expect(await runOnboardingPanel({ ...wizard, readKey: async () => 'enter' })).toBe('setup');
    expect(await runOnboardingPanel({ ...wizard, readKey: async () => 's' })).toBe('skip');
    expect(await runOnboardingPanel({ ...wizard, readKey: async () => 'q' })).toBe('quit');
    expect(await runOnboardingPanel({ ...wizard, readKey: async () => 'escape' })).toBe('quit');
    expect(await runOnboardingPanel({ ...wizard, readKey: async () => 'ctrl+c' })).toBe('quit');
    expect(await runOnboardingPanel({ ...BASE, readKey: async () => 'enter' })).toBe('skip');
  });
});

/** 手动调度器（帧动画确定性驱动——onboarding-panel.test 与 boot-animation.test 同形各持测试件副本） */
function manualFrameScheduler(): {
  schedule: (fn: () => void, ms: number) => unknown;
  cancel: (handle: unknown) => void;
  fire: () => void;
  pending: () => number;
} {
  const queue: Array<{ id: number; fn: () => void }> = [];
  let nextId = 1;
  return {
    schedule: (fn) => {
      const id = nextId++;
      queue.push({ id, fn });
      return id;
    },
    cancel: (handle) => {
      const at = queue.findIndex((e) => e.id === handle);
      if (at >= 0) queue.splice(at, 1);
    },
    fire: () => {
      const head = queue.shift();
      head?.fn();
    },
    pending: () => queue.length,
  };
}

describe('帧动画段消费（39 池 P4——可选注入，装配位铸门）', () => {
  it('段缺席零行为变：行集一次零 wait 行零 \\r（既有静态面板形不随件漂移）', async () => {
    const writes: string[] = [];
    const decision = await runOnboardingPanel({
      ...BASE,
      write: (t) => writes.push(t),
      readKey: async () => 'q',
    });
    expect(decision).toBe('quit');
    expect(writes).toHaveLength(1); // 行集恰一次（帧段缺席不追加写出）
    expect(writes[0]).not.toContain('\r');
  });

  it('帧表单源锁·行为半（onboarding 消费同表）+ 帧推进：wait 行沿 boot 帧表逐帧 \\r 整行重写，未识别键不破拍', async () => {
    const clock = manualFrameScheduler();
    const anim = new GuideFrameAnimation({ schedule: clock.schedule, cancel: clock.cancel });
    const writes: string[] = [];
    let giveKey: (key: string) => void = () => {};
    const decision = runOnboardingPanel({
      ...BASE,
      write: (t) => writes.push(t),
      readKey: () => new Promise<string>((resolve) => (giveKey = resolve)),
      frameAnimation: anim,
    });
    // 行集 + 首帧 wait 行已同步落（start 首帧同步交付）
    expect(writes[writes.length - 1]).toBe(`\r${BOOT_FRAME_FAMILIES.orbit[0]} 等待选择…`);
    // 等待期两拍——wait 行沿 boot 帧表推进（同表消费 + \r 整行重写）
    clock.fire();
    clock.fire();
    expect(writes.slice(-2)).toEqual([
      `\r${BOOT_FRAME_FAMILIES.orbit[1]} 等待选择…`,
      `\r${BOOT_FRAME_FAMILIES.orbit[2]} 等待选择…`,
    ]);
    // 未识别键静默再读（wait 行不重绘行集、节拍照摆不破）
    giveKey('x');
    await Promise.resolve();
    await Promise.resolve();
    clock.fire();
    expect(writes[writes.length - 1]).toBe(`\r${BOOT_FRAME_FAMILIES.orbit[3]} 等待选择…`);
    giveKey('enter'); // 降级形 enter = skip
    expect(await decision).toBe('skip');
    expect(writes[writes.length - 1]).toBe('\n'); // 决策收口闭合 wait 行（收尾换行）
    expect(clock.pending()).toBe(0); // 离开引导面零在飞定时器（泄漏锁·面板位）
    expect(anim.isTicking).toBe(false);
  });

  it('门禁静态锁·面板位（禁用形恒首帧）：wait 行静态首帧恰一写、全程零定时器', async () => {
    const clock = manualFrameScheduler();
    const anim = new GuideFrameAnimation({ animationsEnabled: false, schedule: clock.schedule, cancel: clock.cancel });
    const writes: string[] = [];
    const decision = await runOnboardingPanel({
      ...BASE,
      write: (t) => writes.push(t),
      readKey: async () => 'q',
      frameAnimation: anim,
    });
    expect(decision).toBe('quit');
    expect(writes[1]).toBe(`\r${BOOT_FRAME_FAMILIES.orbit[0]} 等待选择…`); // 静态首帧 wait 行
    expect(writes.filter((w) => w.includes('等待选择'))).toHaveLength(1); // 恒一帧一写（零推进零重写）
    expect(clock.pending()).toBe(0); // 门禁形零定时器（面板全程无摆拍）
    expect(writes[writes.length - 1]).toBe('\n'); // 收口换行照写（wait 行闭合两形同）
  });

  it('帧表单源锁·结构半：面板源零帧字素内嵌、经 boot-animation 单源 import（禁两处内嵌）', () => {
    const source = readFileSync(new URL('./onboarding-panel.ts', import.meta.url), 'utf8');
    expect(source).toContain("from './boot-animation.js'"); // 段类型单源 import 在场
    // 三族全帧字素零落本件（内嵌即红——帧表单源的结构半锁）
    for (const frames of Object.values(BOOT_FRAME_FAMILIES)) {
      for (const frame of frames) expect(source).not.toContain(frame);
    }
  });
});
