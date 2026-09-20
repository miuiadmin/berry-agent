/**
 * host/session-export 单元测试（07 §4.1 命令面增补批 C2——markdown 拼装
 * 单源 + 落盘腿 + 命令腿）。
 *
 * 钉死：空会话仅文档头骨架（空壳导出亦是真答复）/ 轮次分节 + thinking
 * 折叠行 + 工具卡简行三呈现位 / 落盘路径律（exports/<id>-<时间戳>.md）/
 * 命令腿会话解析序（显式 id > 命令锚 > focusedId）与 SESSION_NOT_FOUND
 * fail-loud 回执。事件构造直用 contracts SessionEvent（deriveMessages 真
 * fold——拼装格式锁在投影真源之上，非 mock 投影）。
 */
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import type { SessionEvent } from '../contracts/index.js';

import {
  renderSessionMarkdown,
  runSessionExportCommand,
  SESSION_EXPORT_USAGE,
  writeSessionExport,
  type SessionExportCommandDeps,
} from './session-export.js';

/** 造事件 helper（time 与 seq 同值——测试确定性） */
function evt(seq: number, type: string, data: unknown = {}): SessionEvent {
  return { type, seq, time: seq, data };
}

/** 固定导出时刻（文档头/文件名时间戳确定性——2026-09-16T00:00:00Z） */
const NOW = Date.parse('2026-09-16T00:00:00Z');

/** 临时目录族 */
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 一轮完整对话事件（user → thinking+text 助手 → 工具调用对 → 收尾助手） */
function dialogueEvents(): SessionEvent[] {
  return [
    evt(0, 'turn/start'),
    evt(1, 'user/message', { content: '帮我读配置' }),
    evt(2, 'assistant/message', {
      content: [
        { type: 'thinking', thinking: '先看文件再答复' },
        { type: 'text', text: '好的，先读取。' },
      ],
      stopReason: 'toolUse',
    }),
    evt(3, 'tool/call', { toolCallId: 'c1', name: 'read', arguments: '{"path":"x"}' }),
    evt(4, 'tool/result', { toolCallId: 'c1', content: '文件内容' }),
    evt(5, 'assistant/message', { content: [{ type: 'text', text: '读完了。' }], stopReason: 'end' }),
    evt(6, 'turn/end', { reason: 'completed' }),
  ];
}

describe('renderSessionMarkdown 拼装单源', () => {
  it('空会话 = 仅文档头骨架照落盘（不拒）', () => {
    const markdown = renderSessionMarkdown({
      events: [],
      meta: { sessionId: 's-empty', title: '某标题', workspaceRoot: '/tmp/ws', createdAt: 1 },
      now: NOW,
    });
    expect(markdown).toContain('# 会话导出 `s-empty`');
    expect(markdown).toContain('- 标题：某标题');
    expect(markdown).toContain('- 工作区：/tmp/ws');
    expect(markdown).toContain('- 创建时间：1970-01-01T00:00:00.001Z');
    expect(markdown).toContain('- 导出时间：2026-09-16T00:00:00.000Z');
    expect(markdown).toContain('- 事件数：0');
    // 空会话无正文段——分隔线与轮次节不出现（骨架即全文）
    expect(markdown).not.toContain('---');
    expect(markdown).not.toContain('轮次');
  });

  it('文档头标题净化（第五役 G6 存量脏 title 双保险）：逃逸序列/控制字节/零宽剥除，净化归空不落行', () => {
    // 修前红：meta.title 原样落盘——markdown 是终端外又一落屏载体（编辑器/
    //   less/cat 呈看导出文件时逃逸序列可被解释）；写路物化已源头净化，此面
    //   兜旧码落库的脏 title
    const markdown = renderSessionMarkdown({
      events: [],
      meta: { sessionId: 's-dirty', title: '\x1b]0;evil\x07实\x00际​标题' },
      now: NOW,
    });
    expect(markdown).toContain('- 标题：实际标题');
    expect(markdown).not.toContain('\x1b');
    expect(markdown).not.toContain('\x00');
    expect(markdown).not.toContain('​');
    // 净化归空（不可见形态）诚实退行缺席——不落空标题行
    const invisible = renderSessionMarkdown({
      events: [],
      meta: { sessionId: 's-invisible', title: '\x1b[2J​' },
      now: NOW,
    });
    expect(invisible).not.toContain('标题');
  });

  it('轮次 + thinking 折叠行 + 工具卡简行（投影真源驱动三呈现位）', () => {
    const markdown = renderSessionMarkdown({
      events: dialogueEvents(),
      meta: { sessionId: 's-dlg' },
      now: NOW,
    });
    expect(markdown).toContain('## 轮次 1');
    expect(markdown).toContain('**用户**');
    expect(markdown).toContain('帮我读配置');
    expect(markdown).toContain('**助手**');
    expect(markdown).toContain('好的，先读取。');
    expect(markdown).toContain('> [thinking] 先看文件再答复'); // thinking 折叠行
    expect(markdown).toContain('- ▸ 工具 `read`：{"path":"x"}'); // 工具卡简行（调用）
    expect(markdown).toContain('- ◂ `read` 结果：文件内容'); // 工具卡简行（结果）
    expect(markdown).toContain('读完了。');
    expect(markdown).toContain('- 事件数：7');
  });

  it('thinking 超帽折叠：截断 + 共 N 字注记（全文不落导出）', () => {
    const long = '长思考'.repeat(100); // 300 字 > 120 帽
    const markdown = renderSessionMarkdown({
      events: [evt(0, 'assistant/message', { content: [{ type: 'thinking', thinking: long }] })],
      meta: { sessionId: 's-think' },
      now: NOW,
    });
    expect(markdown).toContain('> [thinking] 长思考长思考'); // 折叠头段在场
    expect(markdown).toContain(`（共 ${long.length} 字）`); // 长度注记
    expect(markdown).not.toContain(`${long}（`); // 全文未整体落盘
  });

  it('错误工具结果与错误终态轮各带标记；注入归因注记', () => {
    const markdown = renderSessionMarkdown({
      events: [
        evt(0, 'user/message', { content: '再试', source: 'channel:webui' }),
        evt(1, 'assistant/message', {
          content: [],
          stopReason: 'error',
          errorMessage: '模型超时',
        }),
        evt(2, 'tool/call', { toolCallId: 'e1', name: 'run', arguments: '' }),
        evt(3, 'tool/result', { toolCallId: 'e1', content: '炸了', error: true }),
      ],
      meta: { sessionId: 's-err' },
      now: NOW,
    });
    expect(markdown).toContain('**用户**（source：channel:webui）'); // 注入归因注记
    expect(markdown).toContain('> [错误] 模型超时'); // 错误终态轮失败说明
    expect(markdown).toContain('（错误）：炸了'); // 错误结果标记
  });

  it('先导用户消息前的消息归开头段不编号；图像块不落正文', () => {
    const markdown = renderSessionMarkdown({
      events: [
        evt(0, 'assistant/message', {
          content: [
            { type: 'text', text: '预置结论' },
            { type: 'image', data: 'aGk=' },
          ],
        }),
        evt(1, 'user/message', { content: '接着问' }),
      ],
      meta: { sessionId: 's-pre' },
      now: NOW,
    });
    expect(markdown).toContain('## 开头段（先导用户消息前）');
    expect(markdown.indexOf('开头段')).toBeLessThan(markdown.indexOf('## 轮次 1')); // 开头段在前
    expect(markdown).toContain('预置结论');
    expect(markdown).toContain('（图像块——不落导出正文）');
  });
});

describe('writeSessionExport 落盘腿', () => {
  it('落盘 数据目录/exports/<会话id>-<时间戳>.md 且内容 = 拼装单源全文', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'session-export-'));
    dirs.push(dataDir);
    const input = { events: dialogueEvents(), meta: { sessionId: 's-write' }, now: NOW };
    const path = writeSessionExport(dataDir, input);
    // 路径律：exports/ 子目录 + id-时间戳.md（ISO 压形——冒号点已替换）
    expect(path).toContain(join(dataDir, 'exports', 's-write-2026-09-16T00-00-00-000Z.md'));
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, 'utf8')).toBe(renderSessionMarkdown(input)); // 两面同源
  });
});

describe('runSessionExportCommand 命令腿（TUI/CLI 两消费单源）', () => {
  /** 基线 deps（可覆写单点） */
  function depsOf(overrides: Partial<SessionExportCommandDeps> = {}): SessionExportCommandDeps {
    const dataDir = mkdtempSync(join(tmpdir(), 'session-export-cmd-'));
    dirs.push(dataDir);
    return {
      dataDir,
      rowOf: () => ({ title: '行面标题', workspaceRoot: '/tmp/ws', createdAt: 5 }),
      eventsOf: () => dialogueEvents(),
      focusedId: () => 'f-focused',
      now: () => NOW,
      ...overrides,
    };
  }

  it('无参 = 命令锚会话（锚位优先于 focusedId 现取）；回执一行路径', async () => {
    const seen: string[] = [];
    const deps = depsOf({ eventsOf: (sid) => (seen.push(sid), dialogueEvents()) });
    const outcome = await runSessionExportCommand([], 'a-anchor', deps);
    expect(outcome.ok).toBe(true);
    expect(seen).toEqual(['a-anchor']); // 解析序：锚位先于 focusedId
    expect(outcome.text).toContain('已导出 7 事件 → ');
    expect(outcome.text).toContain(join(deps.dataDir as string, 'exports', 'a-anchor-')); // 落盘路径在回执
  });

  it('显式 id 参最优先；锚位与焦点让位', async () => {
    const seen: string[] = [];
    const deps = depsOf({ eventsOf: (sid) => (seen.push(sid), []) });
    const outcome = await runSessionExportCommand(['x-explicit'], 'a-anchor', deps);
    expect(seen).toEqual(['x-explicit']);
    expect(outcome.ok).toBe(true);
    expect(outcome.text).toContain('已导出 0 事件 → '); // 空会话照导出（仅文档头）
  });

  it('参数过多 / 无锚无焦点 / 会话不在场 / 纯 memory 形四诚实拒', async () => {
    // 参数过多：用法 fail-loud（带参形不穿透）
    const tooMany = await runSessionExportCommand(['a', 'b'], undefined, depsOf());
    expect(tooMany.ok).toBe(false);
    expect(tooMany.text).toContain('参数过多');
    expect(tooMany.text).toContain(SESSION_EXPORT_USAGE);
    // 无参且无锚无焦点：无焦点可导诚实拒
    const noFocus = await runSessionExportCommand([], undefined, depsOf({ focusedId: () => null }));
    expect(noFocus.ok).toBe(false);
    expect(noFocus.text).toContain('无焦点会话可导出');
    // 指定 id 不在场：SESSION_NOT_FOUND fail-loud 回执（既有错误码族）
    const missing = await runSessionExportCommand(['no-such'], undefined, depsOf({ eventsOf: () => undefined }));
    expect(missing.ok).toBe(false);
    expect(missing.text).toContain('SESSION_NOT_FOUND：会话不存在（no-such）');
    // 纯 memory 形（dataDir null）：无落盘位诚实拒
    const memory = await runSessionExportCommand(['m1'], undefined, depsOf({ dataDir: null }));
    expect(memory.ok).toBe(false);
    expect(memory.text).toContain('数据目录缺席');
  });

  it('零事件活体新会话（行缺席）：文档头元数据行缺席照导出', async () => {
    const deps = depsOf({ rowOf: () => undefined, eventsOf: () => [] });
    const outcome = await runSessionExportCommand(['live-new'], undefined, deps);
    expect(outcome.ok).toBe(true);
    expect(outcome.text).toContain('已导出 0 事件 → ');
    expect(readFileSync(outcome.text.split(' → ')[1]!, 'utf8')).not.toContain('- 标题：'); // 无行面元数据行
  });
});
