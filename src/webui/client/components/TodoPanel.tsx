/**
 * webui/client/components/TodoPanel — todo 侧栏底（批 18a-2）。
 *
 * goal 计划态呈现投影（GET /api/sessions/:id/todo 的消费位）；四态记号
 * 与 TUI 呈现约定同源（☐ ◐ ☑ ⊙）。无数据源诚实空态（null ≠ []——
 * 服务端 todoOf 缺席语义透传）。
 */
import type { ReactElement } from 'react';

import type { ViewTodo } from '../frames.js';

/** 四态呈现记号（TUI 同源词面） */
const MARKS: Readonly<Record<string, string>> = {
  pending: '☐',
  'in-progress': '◐',
  completed: '☑',
  deferred: '⊙',
};

/** todo 面板（null = 无数据源 / [] = 空计划——两形分立呈现） */
export function TodoPanel({ todo }: { todo: readonly ViewTodo[] | null }): ReactElement {
  return (
    <div className="border-t border-zinc-800">
      <div className="px-3 py-2 text-xs font-semibold text-zinc-400">计划</div>
      {todo === null ? (
        <p className="px-3 pb-2 text-[11px] text-zinc-600">无数据源</p>
      ) : todo.length === 0 ? (
        <p className="px-3 pb-2 text-[11px] text-zinc-600">（空）</p>
      ) : (
        <ul className="max-h-48 space-y-0.5 overflow-y-auto px-3 pb-2">
          {todo.map((item, idx) => (
            <li
              key={`${idx}-${item.content}`}
              className={`truncate text-[11px] ${item.status === 'completed' || item.status === 'deferred' ? 'text-zinc-600' : 'text-zinc-300'}`}
              title={item.activeForm ?? item.content}
            >
              {MARKS[item.status] ?? '·'} {item.activeForm ?? item.content}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
