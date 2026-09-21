/**
 * 启动动画件直锁（07 §4.1 呈现面件 10——三反馈批D 案A cooked 逐行）。
 *
 * 直锁面：
 * - 阶段行逐行呈现（六阶段词汇单源 + 段序）与头行一次；
 * - 零 CSI/OSC 锁（动画窗纯文本字节域——进屏序律射程外的写侧结构锁）；
 * - 未识阶段 fail-open（直用阶段 id 不炸）；
 * - stderr 打点件（BERRY_AGENT_TIMING 门——段计时汇总 + TOTAL；门关零写出；
 *   诊断道与呈现道分立：ms 只入 stderr 面）；
 * - finish 幂等 + 装配失败路部分留存；
 * - 呈现件自保（io 写出抛错不外炸——assembly 层隔离之外的兜底层）；
 * - plugin id 控制字节剥除（写侧防御——id 溢控制字节不透传终端）。
 */
import { describe, expect, it } from 'vitest';
import { BootAnimation } from './boot-animation.js';

/** 收集型写入面（io / stderr 两位通用） */
function sink(): { writes: string[]; write: (text: string) => void } {
  const writes: string[] = [];
  return { writes, write: (text: string) => writes.push(text) };
}

/** 注入钟（确定性段计时——缺省 Date.now 的测试替代） */
function manualClock(): { now: () => number; advance: (ms: number) => void } {
  let t = 0;
  return { now: () => t, advance: (ms) => (t += ms) };
}

/**
 * 六阶段全序列回放（先行件2 事件形——含 plugins 尾 detail enabled=N,total=M）。
 * 段时序：运行时 12 / 会话栈 5 / 插件（首插件前）3 / core:memory 8 / core:obs 4
 * / 技能 3 / 子代理域 2——合计 37ms（ready 瞬时相位只发 end 无段）。
 */
function replayBoot(anim: BootAnimation, clock: { advance: (ms: number) => void }): void {
  anim.stage('runtime', 'start');
  clock.advance(12);
  anim.stage('runtime', 'end');
  clock.advance(2);
  anim.stage('stack', 'start');
  clock.advance(5);
  anim.stage('stack', 'end');
  clock.advance(1);
  anim.stage('plugins', 'start');
  clock.advance(3);
  anim.pluginLoad('core:memory', 1, 2);
  clock.advance(8);
  anim.pluginLoad('core:obs', 2, 2);
  clock.advance(4);
  anim.stage('plugins', 'end', 'enabled=2,total=2');
  clock.advance(2);
  anim.stage('skills', 'start');
  clock.advance(3);
  anim.stage('skills', 'end');
  clock.advance(1);
  anim.stage('subagents', 'start');
  clock.advance(2);
  anim.stage('subagents', 'end');
  clock.advance(1);
  anim.stage('ready', 'end');
}

describe('BootAnimation 启动动画件（三反馈批D——案A cooked 逐行）', () => {
  it('阶段行逐行 + 词汇单源 + 段序：头行一次，阶段完成行按序，插件行带 i/N', () => {
    const io = sink();
    const clock = manualClock();
    const anim = new BootAnimation(io.write, { version: '9.9.9', now: clock.now });
    replayBoot(anim, clock);
    const text = io.writes.join('');
    // 头行一次（首事件触发出——版本串入头行）
    expect(text).toContain('berry-agent v9.9.9');
    expect(text.split('berry-agent').length - 1).toBe(1);
    // 六阶段呈现词（词汇表单源——runtime=运行时/stack=会话栈/plugins=插件/
    // skills=技能/subagents=子代理域/ready=就绪）
    expect(text).toContain('✓ 运行时');
    expect(text).toContain('✓ 会话栈');
    expect(text).toContain('✓ 技能');
    expect(text).toContain('✓ 子代理域');
    expect(text).toContain('✓ 就绪');
    // 插件装载行（装载前达——i/N 计数）+ plugins 尾计数行（detail 解析形）
    expect(text).toContain('▸ 装载 core:memory（1/2）');
    expect(text).toContain('▸ 装载 core:obs（2/2）');
    expect(text).toContain('✓ 插件（启用 2/共 2）');
    // 段序：头行 → 运行时 → 首插件行 → 插件计数 → 就绪（严格递增）
    const order = [
      text.indexOf('berry-agent'),
      text.indexOf('✓ 运行时'),
      text.indexOf('▸ 装载 core:memory'),
      text.indexOf('✓ 插件（'),
      text.indexOf('✓ 就绪'),
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('零 CSI/OSC 锁：动画窗纯文本字节域（除 \\n 外零控制字节——进屏序律射程外写侧锁）', () => {
    const io = sink();
    const clock = manualClock();
    const anim = new BootAnimation(io.write, { now: clock.now });
    replayBoot(anim, clock);
    const text = io.writes.join('');
    // ESC（0x1b）/CSI 单字节（0x9b）/BEL（0x07）零出现——无色彩 SGR 无光标控制
    expect(text).not.toContain('\x1b');
    expect(text).not.toContain('\x9b');
    expect(text).not.toContain('\x07');
    // 除 \n 外零 C0 控制字节（\t 也禁——列定位随终端制表设置漂移）
    for (const ch of text) {
      const code = ch.codePointAt(0)!;
      expect(code === 0x0a || (code >= 0x20 && code !== 0x7f)).toBe(true);
    }
  });

  it('未识阶段 fail-open：直用阶段 id 呈现不炸（词汇表前瞻兼容）', () => {
    const io = sink();
    const anim = new BootAnimation(io.write, {});
    anim.stage('mystery', 'end');
    expect(io.writes.join('')).toContain('✓ mystery');
  });

  it('stderr 打点件：门关零写出；门开段计时汇总 + TOTAL；诊断道与呈现道分立', () => {
    // 门关：finish 零 stderr 写出
    const ioOff = sink();
    const errOff = sink();
    const clockOff = manualClock();
    const off = new BootAnimation(ioOff.write, { now: clockOff.now, stderr: errOff.write });
    replayBoot(off, clockOff);
    off.finish();
    expect(errOff.writes).toEqual([]);
    // 门开：段汇总 + TOTAL（ready 收尾）
    const ioOn = sink();
    const errOn = sink();
    const clockOn = manualClock();
    const on = new BootAnimation(ioOn.write, { now: clockOn.now, stderr: errOn.write, timingEnabled: true });
    replayBoot(on, clockOn);
    on.finish();
    const diag = errOn.writes.join('');
    expect(diag).toContain('--- 启动计时 ---');
    expect(diag).toContain('运行时: 12ms');
    expect(diag).toContain('会话栈: 5ms');
    expect(diag).toContain('插件 core:memory: 8ms');
    expect(diag).toContain('插件 core:obs: 4ms');
    expect(diag).toContain('子代理域: 2ms');
    expect(diag).toContain('TOTAL: 37ms');
    // 分立律：ms 字样只入 stderr 面——动画行不含计时（行间隔即耗时）
    expect(ioOn.writes.join('')).not.toContain('ms');
  });

  it('finish 幂等 + 装配失败路：部分阶段后 finish 汇总留存段，动画行不撤', () => {
    const io = sink();
    const err = sink();
    const clock = manualClock();
    const anim = new BootAnimation(io.write, { now: clock.now, stderr: err.write, timingEnabled: true });
    // 失败路：只走完 runtime + stack（plugins 起步即炸的形态）
    anim.stage('runtime', 'start');
    clock.advance(12);
    anim.stage('runtime', 'end');
    clock.advance(2);
    anim.stage('stack', 'start');
    clock.advance(5);
    anim.stage('stack', 'end');
    anim.finish();
    anim.finish(); // 幂等：二次收尾零重复汇总
    expect(io.writes.join('')).toContain('✓ 运行时');
    expect(io.writes.join('')).toContain('✓ 会话栈');
    const diag = err.writes.join('');
    expect(diag).toContain('运行时: 12ms');
    expect(diag).toContain('TOTAL: 17ms');
    expect(diag.split('--- 启动计时 ---').length - 1).toBe(1); // 汇总恰一次
  });

  it('stage start 零行：开阶段不出行动画（完成行才是可见刻度），头行只出一次', () => {
    const io = sink();
    const anim = new BootAnimation(io.write, { version: '1.0.0' });
    anim.stage('runtime', 'start');
    const text = io.writes.join('');
    expect(text).toContain('berry-agent v1.0.0'); // 头行（首事件触发）
    expect(text).not.toContain('运行时'); // start 相位零阶段行
    anim.stage('runtime', 'end');
    expect(io.writes.join('')).toContain('✓ 运行时');
  });

  it('呈现件自保：io 写出抛错不外炸（fail-open 双保的呈现侧兜底）', () => {
    const anim = new BootAnimation(() => {
      throw new Error('io broken');
    }, {});
    expect(() => {
      anim.stage('runtime', 'start');
      anim.stage('runtime', 'end');
      anim.pluginLoad('core:x', 1, 1);
      anim.finish();
    }).not.toThrow();
  });

  it('plugin id 控制字节剥除：溢出控制字节不透传终端（写侧防御）', () => {
    const io = sink();
    const anim = new BootAnimation(io.write, {});
    anim.pluginLoad('bad\x07id', 1, 1); // BEL 中置——剥除后整 id 连续呈现
    expect(io.writes.join('')).toContain('badid');
    expect(io.writes.join('')).not.toContain('\x07');
    // ESC 序列形（CSI 清屏构造）：ESC 剥除后余纯文本直呈——无执行面
    anim.pluginLoad('x\x1b[2Jy', 2, 2);
    const text = io.writes.join('');
    expect(text).not.toContain('\x1b');
    expect(text).toContain('x[2Jy');
  });

  it('未识阶段 id 控制字节剥除（全域清扫 #4 对称补——fallback 词同 pluginLoad 防御律）', () => {
    const io = sink();
    const anim = new BootAnimation(io.write, {});
    anim.stage('we\x07ird', 'end'); // 未识 id 带 BEL——词汇表 miss 走 fallback
    const text = io.writes.join('');
    expect(text).toContain('✓ weird');
    expect(text).not.toContain('\x07');
    anim.stage('x\x1b[2Jy', 'end'); // ESC 序列形：ESC 剥除余纯文本直呈
    const text2 = io.writes.join('');
    expect(text2).not.toContain('\x1b');
    expect(text2).toContain('✓ x[2Jy');
  });

  it('finish 悬段收口入账：开放段经 finish 结算入段账（全域清扫 #6——失败路中途段不丢面）', () => {
    const io = sink();
    const err = sink();
    const clock = manualClock();
    const anim = new BootAnimation(io.write, { now: clock.now, stderr: err.write, timingEnabled: true });
    anim.stage('subagents', 'start'); // 开段后直接收尾（无 end 相位——悬段形态）
    clock.advance(7);
    anim.finish();
    const diag = err.writes.join('');
    expect(diag).toContain('子代理域: 7ms');
    expect(diag).toContain('TOTAL: 7ms');
  });

  it('finish 防御早退：门开零段零汇总；收尾后事件零消费（全域清扫 #7）', () => {
    const io = sink();
    const err = sink();
    const anim = new BootAnimation(io.write, { stderr: err.write, timingEnabled: true });
    anim.finish(); // 零事件零段——segments 空早退分支
    expect(err.writes).toEqual([]);
    anim.stage('runtime', 'end'); // 收尾后事件零消费（头行也不出）
    expect(io.writes.join('')).toBe('');
  });
});
