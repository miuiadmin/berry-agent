/**
 * webui/client/components/Transcript 单件直锁（覆盖锁；jsdom 轨）。
 *
 * 正文列四真行为——
 * ① 空态文案 + 贴底锚挂载（bottomRef 落真实 div——滚动跟随的接线前提）
 * ② 角色分形：assistant 走 Markdown 渲染（**粗体** → strong）、user 纯文本
 * 字面呈现（对话与编码即本体——助手产出以 Markdown 为主形）
 * ③ 流式尾巴呼吸光标：streaming 位呈现 ▍、落稿不呈现
 * ④ 状态行：非 null 呈现列底、null 不占位
 * ⑤ 压缩分隔行（B2 webui 对端迁移）：source='compaction' 的 user 块载体
 *    正文零呈现、替换为居中弱化分隔行（N 解析自 CCR 标记段——两形）
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import type { ViewMessage } from '../frames.js';
import { RUN_CLOSE_ROLE } from '../frames.js';
import { ccrMarkerLine } from '../../../contracts/index.js';
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

  it('错误块 ✗ 前缀直呈错误文本（注⑩ 跨通道同律——✖ 形全域退役）', () => {
    render(
      <Transcript
        messages={[msg({ key: 'm-1', role: 'assistant', text: '半句', error: '模型渠道未配置' })]}
        status={null}
        bottomRef={createRef<HTMLDivElement>()}
      />,
    );
    expect(screen.getByText('✗ 模型渠道未配置')).toBeTruthy(); // 前缀 + 同句原因（失败直呈律）
    expect(screen.queryByText('✖ 模型渠道未配置')).toBeNull(); // 旧形退役锁
  });
});

describe('Transcript 角色与错误类名 token 锁（2026-10-08 浅档可读性批——03 §10.4 批注④浮底修复）', () => {
  it('角色标签引 role token：user 位含 text-role-user · assistant 位含 text-role-assistant（修前红：裸 sky-/emerald- 类浮正文底，浅档实质不可读）', () => {
    render(
      <Transcript
        messages={[msg({ key: 'm-1', role: 'user', text: '问' }), msg({ key: 'm-2', role: 'assistant', text: '答' })]}
        status={null}
        bottomRef={createRef<HTMLDivElement>()}
      />,
    );
    // 类名锁：token 化后浅/深档切换零组件面改动（类名是唯一稳定面——
    // 主题覆写只改 var(--color-role-*) 定值）
    expect(screen.getByText('user').className).toContain('text-role-user');
    expect(screen.getByText('assistant').className).toContain('text-role-assistant');
  });

  it('错误块 danger token：✗ 块含 text-danger（修前红：裸 red-400 类浮正文底浅档不可读——诚实报错底线面）', () => {
    render(
      <Transcript
        messages={[msg({ key: 'm-1', role: 'assistant', text: '半句', error: '模型渠道未配置' })]}
        status={null}
        bottomRef={createRef<HTMLDivElement>()}
      />,
    );
    expect(screen.getByText('✗ 模型渠道未配置').className).toContain('text-danger');
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

  it('状态行非 null 呈现列底（呼吸点 + 文案）、null 不占位', () => {
    const { rerender } = render(<Transcript messages={[]} status="⚙ bash …" bottomRef={createRef<HTMLDivElement>()} />);
    expect(screen.getByText('⚙ bash …')).toBeTruthy();
    rerender(<Transcript messages={[]} status={null} bottomRef={createRef<HTMLDivElement>()} />);
    expect(screen.queryByText('⚙ bash …')).toBeNull();
  });
});

describe('Transcript run 收尾行（界面美化役批⑪）', () => {
  it('run_close 角色居中呈现收尾行文本：无角色标签（非消息形）', () => {
    render(
      <Transcript
        messages={[msg({ key: 'm-close', role: RUN_CLOSE_ROLE, text: '── 用时 1m 30s · 工具 2 次 ──' })]}
        status={null}
        bottomRef={createRef<HTMLDivElement>()}
      />,
    );
    expect(screen.getByText('── 用时 1m 30s · 工具 2 次 ──')).toBeTruthy();
    // 收尾行是瞬时追加位非消息——不呈 run_close 角色标签
    expect(screen.queryByText('run_close')).toBeNull();
  });
});

describe('Transcript 压缩分隔行（B2 webui 对端迁移——source=compaction user 块替换呈现）', () => {
  /** 摘要载体速造：正文 + CCR 标记段末行（N 条消息位即分隔行 N——标记行走 contracts ccrMarkerLine 单源构造，messages 参数化保既有用例形） */
  const carrier = (n: number): string =>
    `[COMPACTION-SUMMARY] 摘要正文\n\n${ccrMarkerLine({ hash: 'abcdef0123456789', messages: n, chars: 287 })}`;

  it('N 形：载体正文零呈现 + 分隔行居中呈现 + 无 user 角色标签（修前红：数千字摘要当普通 user 正文直呈）', () => {
    render(
      <Transcript
        messages={[msg({ key: 'm-1', role: 'user', text: carrier(5), source: 'compaction' })]}
        status={null}
        bottomRef={createRef<HTMLDivElement>()}
      />,
    );
    expect(screen.getByText('── 已压缩 5 条对话 ──')).toBeTruthy();
    expect(screen.queryByText(/COMPACTION-SUMMARY/)).toBeNull(); // 载体本体零呈现（分隔行是压缩事实唯一用户面正文位）
    expect(screen.queryByText(/原文已归档/)).toBeNull(); // CCR 标记行不入用户面
    expect(screen.queryByText('user')).toBeNull(); // 无角色标签（分隔行非消息形——run_close 同律）
  });

  it('降级形：CCR 批前历史载体无标记段 → 无 N 形（修前红）', () => {
    render(
      <Transcript
        messages={[
          msg({ key: 'm-1', role: 'user', text: '[COMPACTION-SUMMARY] 老载体只有正文', source: 'compaction' }),
        ]}
        status={null}
        bottomRef={createRef<HTMLDivElement>()}
      />,
    );
    expect(screen.getByText('── 已压缩 ──')).toBeTruthy();
  });

  it('source 缺席的真 user 消息照常正文呈现（判据不误伤——缺席视为普通 user）', () => {
    render(
      <Transcript
        messages={[msg({ key: 'm-1', role: 'user', text: '普通问句' })]}
        status={null}
        bottomRef={createRef<HTMLDivElement>()}
      />,
    );
    expect(screen.getByText('普通问句')).toBeTruthy();
    expect(screen.getByText('user')).toBeTruthy(); // 角色标签照常
  });
});

/* ---------------- 附件图渲染（2026-10-08 剪贴板附件批——03 §10.4 批注⑥） ---------------- */

describe('Transcript 附件图渲染（剪贴板附件批——image-ref 块 img 元素 + 失败降占位框）', () => {
  /** ref 速造（sha256:<64 hex> 形） */
  const refOf = (digit: string): string => `sha256:${digit.repeat(64)}`;

  it('image-ref 块渲染 img（修前红：ViewMessage 无 images 位——无图可渲）：src = /api/attachments/<ref> 路径段直拼', () => {
    render(
      <Transcript
        messages={[
          msg({ key: 'm-1', role: 'user', text: '看这张', images: [{ ref: refOf('a'), mimeType: 'image/png' }] }),
        ]}
        status={null}
        bottomRef={createRef<HTMLDivElement>()}
      />,
    );
    const img = screen.getByRole('img'); // 修前红：无 img 元素
    expect(img.getAttribute('src')).toBe(`/api/attachments/${refOf('a')}`); // 路径段直拼 ref 串（冒号不编码）
    expect(screen.getByText('看这张')).toBeTruthy(); // 正文位照常（图与文并列呈现）
  });

  it('多图按序多枚 img（图序保留——每块一枚）', () => {
    render(
      <Transcript
        messages={[
          msg({
            key: 'm-1',
            role: 'user',
            text: '',
            images: [
              { ref: refOf('1'), mimeType: 'image/png' },
              { ref: refOf('2'), mimeType: 'image/png' },
            ],
          }),
        ]}
        status={null}
        bottomRef={createRef<HTMLDivElement>()}
      />,
    );
    const imgs = screen.getAllByRole('img');
    expect(imgs).toHaveLength(2);
    expect(imgs[0]!.getAttribute('src')).toBe(`/api/attachments/${refOf('1')}`);
    expect(imgs[1]!.getAttribute('src')).toBe(`/api/attachments/${refOf('2')}`);
  });

  it('加载失败降占位框（修前红）：img error 后退场、「[图片已不可用]」占位在场（附件库文件缺席——诚实降级）', () => {
    render(
      <Transcript
        messages={[
          msg({ key: 'm-1', role: 'user', text: '看这张', images: [{ ref: refOf('f'), mimeType: 'image/png' }] }),
        ]}
        status={null}
        bottomRef={createRef<HTMLDivElement>()}
      />,
    );
    const img = screen.getByRole('img');
    fireEvent.error(img);
    expect(screen.getByText('[图片已不可用]')).toBeTruthy(); // 修前红：无降级编舞——占位恒不出现
    expect(screen.queryByRole('img')).toBeNull(); // 坏图退场（不留破图符）
  });
});
