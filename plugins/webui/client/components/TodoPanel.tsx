/**
 * webui/client/components/TodoPanel — todo 侧栏底（批 18a-2）。
 *
 * goal 计划态呈现投影（GET /api/sessions/:id/todo 的消费位）；四态记号
 * 与 TUI 呈现约定同源（☐ ◐ ☑ ⊙）。无数据源诚实空态（null ≠ []——
 * 服务端 todoOf 缺席语义透传）。完成/搁置项划线降档（界面美化役批⑤——
 * 完成态视觉可辨）。
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
    <div className="border-t border-edge">
      <div className="px-3 py-2 text-xs font-semibold text-ink-soft">计划</div>
      {todo === null ? (
        <p className="px-3 pb-2 text-2xs text-ink-faint">无数据源</p>
      ) : todo.length === 0 ? (
        <p className="px-3 pb-2 text-2xs text-ink-faint">（空）</p>
      ) : (
        <ul className="max-h-48 space-y-0.5 overflow-y-auto px-3 pb-2">
          {todo.map((item, idx) => (
            /* 完成/搁置项：划线 + 弱文降档（完成态一眼可辨——进行中项相对突出） */
            <li
              key={`${idx}-${item.content}`}
              className={`truncate text-2xs ${
                item.status === 'completed' || item.status === 'deferred' ? 'text-ink-mute line-through' : 'text-ink'
              }`}
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
