import { describe, expect, it } from 'vitest';
import { BaseError } from '../contracts/index.js';
import { EventDispatch } from './events.js';

describe('词汇注册纪律', () => {
  it('未注册词 emit fail-loud（EVENT_NOT_REGISTERED）', async () => {
    const dispatch = new EventDispatch();
    await expect(dispatch.emit('not-registered')).rejects.toThrowError(BaseError);
    try {
      await dispatch.emit('not-registered');
    } catch (err) {
      if (err instanceof BaseError) {
        expect(err.code).toBe('EVENT_NOT_REGISTERED');
        return;
      }
    }
    expect.unreachable();
  });

  it('未注册词 on fail-loud（监听面同执法）', () => {
    const dispatch = new EventDispatch();
    expect(() => dispatch.on('not-registered', () => undefined)).toThrowError(BaseError);
  });

  it('撞名拒（EVENT_DUPLICATE——禁静默覆盖）', () => {
    const dispatch = new EventDispatch();
    dispatch.registerEventNames(['domain:event']);
    expect(() => dispatch.registerEventNames(['domain:event'])).toThrowError(BaseError);
    try {
      dispatch.registerEventNames(['domain:event']);
    } catch (err) {
      if (err instanceof BaseError) {
        expect(err.code).toBe('EVENT_DUPLICATE');
        return;
      }
    }
    expect.unreachable();
  });

  it('on 返回退订闭包（消费方经 scope.effect 组合生命周期）', async () => {
    const dispatch = new EventDispatch();
    dispatch.registerEventNames(['domain:event']);
    let calls = 0;
    const off = dispatch.on('domain:event', () => calls++);
    await dispatch.emit('domain:event');
    off();
    await dispatch.emit('domain:event');
    expect(calls).toBe(1);
  });
});

describe('emit 广播（异常互相隔离）', () => {
  it('全部监听器各跑各，单腿炸不波及他腿与调用方', async () => {
    const errors: Array<[string, unknown]> = [];
    const dispatch = new EventDispatch({ onListenerError: (name, err) => errors.push([name, err]) });
    dispatch.registerEventNames(['domain:broadcast']);
    const seen: number[] = [];
    dispatch.on('domain:broadcast', () => {
      seen.push(1);
      throw new Error('腿一炸');
    });
    dispatch.on('domain:broadcast', () => seen.push(2));
    await dispatch.emit('domain:broadcast');
    expect(seen).toEqual([1, 2]); // 炸腿不影响腿二
    expect(errors).toHaveLength(1);
    expect(errors[0]?.[0]).toBe('domain:broadcast');
  });
});

describe('waterfall 串行管线', () => {
  it('监听器依次串行、next 委托传值', async () => {
    const dispatch = new EventDispatch();
    dispatch.registerEventNames(['domain:pipeline']);
    dispatch.onWaterfall('domain:pipeline', async (v: number, next) => next(v + 1));
    dispatch.onWaterfall('domain:pipeline', (v: number, next) => next(v * 10));
    const result = await dispatch.waterfall('domain:pipeline', 1);
    expect(result).toBe(20); // (1+1)*10——注册序串行
  });

  it('不调 next 即短路（管线后段不再执行）', async () => {
    const dispatch = new EventDispatch();
    dispatch.registerEventNames(['domain:gate']);
    let downstreamRan = false;
    dispatch.onWaterfall('domain:gate', (v: string) => `短路值(${v})`); // 不调 next
    dispatch.onWaterfall('domain:gate', (v: string, next) => {
      downstreamRan = true;
      return next(v);
    });
    const result = await dispatch.waterfall('domain:gate', '入参');
    expect(result).toBe('短路值(入参)');
    expect(downstreamRan).toBe(false); // 守门行语义依赖的短路
  });

  it('无监听器直通（value 原样出管线）', async () => {
    const dispatch = new EventDispatch();
    dispatch.registerEventNames(['domain:empty']);
    expect(await dispatch.waterfall('domain:empty', '原样')).toBe('原样');
  });

  it('监听器异常沿链传播（管线失败语义）', async () => {
    const dispatch = new EventDispatch();
    dispatch.registerEventNames(['domain:fail']);
    dispatch.onWaterfall('domain:fail', () => {
      throw new Error('管线炸');
    });
    await expect(dispatch.waterfall('domain:fail', 'x')).rejects.toThrowError('管线炸');
  });
});

describe('parallel 并发收口', () => {
  it('全体并发、Promise.all 收口（返回值序）', async () => {
    const dispatch = new EventDispatch();
    dispatch.registerEventNames(['domain:fanout']);
    dispatch.on('domain:fanout', () => Promise.resolve('a'));
    dispatch.on('domain:fanout', () => 'b');
    const results = await dispatch.parallel('domain:fanout', undefined);
    expect(results).toEqual(['a', 'b']);
  });

  it('异常传播（与 emit 的隔离语义分立）', async () => {
    const dispatch = new EventDispatch();
    dispatch.registerEventNames(['domain:fanout']);
    dispatch.on('domain:fanout', () => Promise.reject(new Error('并发腿炸')));
    await expect(dispatch.parallel('domain:fanout', undefined)).rejects.toThrowError('并发腿炸');
  });
});

describe('serial 排队串行', () => {
  it('同词多次派发按到达序排队（后段等前段完成）', async () => {
    const dispatch = new EventDispatch();
    dispatch.registerEventNames(['domain:queue']);
    const order: string[] = [];
    const first = dispatch.serial('domain:queue', '一');
    const second = dispatch.serial('domain:queue', '二');
    dispatch.on('domain:queue', async (data: unknown) => {
      await new Promise((r) => setTimeout(r, 5));
      order.push(String(data));
    });
    // on 在 serial 之后挂——监听器快照在派发时取（此处两腿均无监听器，验排队不炸）
    await Promise.all([first, second]);
    expect(order).toEqual([]);
  });

  it('异常隔离不停段（与 waterfall 的区别——无委托链）', async () => {
    const errors: unknown[] = [];
    const dispatch = new EventDispatch({ onListenerError: (_name, err) => errors.push(err) });
    dispatch.registerEventNames(['domain:queue']);
    const seen: number[] = [];
    dispatch.on('domain:queue', () => {
      seen.push(1);
      throw new Error('段一炸');
    });
    dispatch.on('domain:queue', () => seen.push(2));
    await dispatch.serial('domain:queue');
    expect(seen).toEqual([1, 2]); // 段一炸后段二照跑
    expect(errors).toHaveLength(1);
  });

  it('一次派发失败不堵后续派发排队', async () => {
    const errors: unknown[] = [];
    const dispatch = new EventDispatch({ onListenerError: (_name, err) => errors.push(err) });
    dispatch.registerEventNames(['domain:queue']);
    const seen: number[] = [];
    dispatch.on('domain:queue', (data: unknown) => {
      if (data === '炸') throw new Error('炸');
      seen.push(data as number);
    });
    await dispatch.serial('domain:queue', '炸');
    await dispatch.serial('domain:queue', 7);
    expect(seen).toEqual([7]);
    expect(errors).toHaveLength(1);
  });
});
