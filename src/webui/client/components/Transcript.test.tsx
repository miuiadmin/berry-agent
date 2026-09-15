/**
 * webui/client/components/Transcript 单件直锁（覆盖锁；jsdom 轨）。
 *
 * 正文列四真行为——
 * ① 空态文案 + 贴底锚挂载（bottomRef 落真实 div——滚动跟随的接线前提）
 * ② 角色分形：assistant 走 Markdown 渲染（**粗体** → strong）、user 纯文本
 * 字面呈现（对话与编码即本体——助手产出以 Markdown 为主形）
 * ③ 流式尾巴呼吸光标：streaming 位呈现 ▍、落稿不呈现
 * ④ 状态行：非 null 呈现列底、null 不占位
 */
import { cleanup, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import type { ViewMessage } from '../frames.js';
import { Transcript } from './Transcript.js';

afterEach(() => {
  cleanup();
});

/** 消息视图速造 */
function msg(partial: Partial<ViewMessage> & { key: string; role: string; text: string }): ViewMessage {
  return { streaming: false, ...partial };
}

describe('Transcript 空态与贴底锚', () => {
  it('空正文呈引导文案 + bottomRef 挂真实 div', () => {
    const bottomRef = createRef<HTMLDivElement>();
    render(<Transcript messages={[]} status={null} bottomRef={bottomRef} />);
    expect(screen.getByText('（暂无消息——发送第一条）')).toBeTruthy();
    expect(bottomRef.current).toBeTruthy();
    expect(bottomRef.current!.tagName).toBe('DIV');
  });
});

describe('Transcript 角色分形渲染', () => {
  it('assistant 解析 Markdown（粗体成 strong）；user 纯文本字面呈现', () => {
    render(
      <Transcript
        messages={[
          msg({ key: 'm-1', role: 'user', text: '**不是粗体**' }),
          msg({ key: 'm-2', role: 'assistant', text: '**是粗体**' }),
        ]}
        status={null}
        bottomRef={createRef<HTMLDivElement>()}
      />,
    );
    // user：纯文本节点字面呈现（不解析）
    expect(screen.getByText('**不是粗体**').tagName).toBe('P');
    // assistant：Markdown 渲染落 strong 元素
    expect(screen.getByText('是粗体').tagName).toBe('STRONG');
  });

  it('角色标签逐条呈现（user / assistant 小写原样）', () => {
    render(
      <Transcript
        messages={[msg({ key: 'm-1', role: 'user', text: '问' })]}
        status={null}
        bottomRef={createRef<HTMLDivElement>()}
      />,
    );
    expect(screen.getByText('user')).toBeTruthy();
  });
});

describe('Transcript 流式尾巴与状态行', () => {
  it('streaming 位呈呼吸光标 ▍，落稿不呈现', () => {
    const { rerender } = render(
      <Transcript
        messages={[msg({ key: 'm-1', role: 'assistant', text: '半句', streaming: true })]}
        status={null}
        bottomRef={createRef<HTMLDivElement>()}
      />,
    );
    expect(screen.getByText('▍')).toBeTruthy();
    rerender(
      <Transcript
        messages={[msg({ key: 'm-1', role: 'assistant', text: '成稿全句', streaming: false })]}
        status={null}
        bottomRef={createRef<HTMLDivElement>()}
      />,
    );
    expect(screen.queryByText('▍')).toBeNull();
  });

  it('状态行非 null 呈现列底、null 不占位', () => {
    const { rerender } = render(<Transcript messages={[]} status="⚙ bash …" bottomRef={createRef<HTMLDivElement>()} />);
    expect(screen.getByText('⚙ bash …')).toBeTruthy();
    rerender(<Transcript messages={[]} status={null} bottomRef={createRef<HTMLDivElement>()} />);
    expect(screen.queryByText('⚙ bash …')).toBeNull();
  });
});
