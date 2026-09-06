/**
 * 结算通知文案 builder 测试（04 §10 两种收场——纯函数单源）。
 */
import { describe, expect, it } from 'vitest';
import { subagentSettledContent } from './notify.js';

describe('subagentSettledContent 文案', () => {
  it('终态人读词：stop=已完成 / aborted=已中止 / error=失败', () => {
    expect(subagentSettledContent({ jobName: '探索', result: { output: '', stopReason: 'stop' } })).toBe(
      '子代理「探索」已完成。',
    );
    expect(subagentSettledContent({ jobName: '探索', result: { output: '', stopReason: 'aborted' } })).toContain(
      '已中止',
    );
    expect(subagentSettledContent({ jobName: '探索', result: { output: '', stopReason: 'error' } })).toContain('失败');
  });

  it('输出行：非空带「输出：」前缀；空输出零输出行', () => {
    const content = subagentSettledContent({ jobName: 'x', result: { output: '结果正文', stopReason: 'stop' } });
    expect(content.split('\n')).toEqual(['子代理「x」已完成。', '输出：结果正文']);
    const empty = subagentSettledContent({ jobName: 'x', result: { output: '', stopReason: 'stop' } });
    expect(empty).toBe('子代理「x」已完成。');
  });

  it('输出预览帽 512 保头截断 + 截断标记', () => {
    const long = '甲'.repeat(600);
    const content = subagentSettledContent({ jobName: 'x', result: { output: long, stopReason: 'stop' } });
    const outputLine = content.split(String.fromCharCode(10))[1]!;
    expect(outputLine.startsWith(`输出：${'甲'.repeat(512)}`)).toBe(true);
    expect(outputLine.endsWith('…（已截断——全文见子会话日志）')).toBe(true);
    // 帽内零截断标记
    const short = subagentSettledContent({ jobName: 'x', result: { output: '甲'.repeat(512), stopReason: 'stop' } });
    expect(short).not.toContain('已截断');
  });

  it('诊断行如实呈现（禁伪装）：非空 diagnostic 带「诊断：」前缀；空串不产行', () => {
    const content = subagentSettledContent({
      jobName: 'x',
      result: { output: 'o', stopReason: 'error', diagnostic: 'web 工具被拒，以降级路径完成' },
    });
    expect(content.split('\n')[2]).toBe('诊断：web 工具被拒，以降级路径完成');
    const noDiag = subagentSettledContent({
      jobName: 'x',
      result: { output: 'o', stopReason: 'stop', diagnostic: '' },
    });
    expect(noDiag.split('\n')).toHaveLength(2);
  });
});
