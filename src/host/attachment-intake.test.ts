/**
 * host/attachment-intake 测试——剪贴板附件受理链（03 §10.4 ②）+ image-ref
 * 再水化单点（批注⑤）+ 装配桥接线（submitPrompt images 位）。
 *
 * 组合根全栈惯例：真 conversation 栈（真盘真库 + faux provider 走真实
 * streamFn）——mock 只停模型层；受理链单元腿用真附件库（tmpdir 真落盘）。
 * 修前红锚：骨架桩 throw 形（能力门/数量帽/坏 base64/超 5MiB/非四族魔数/
 * MIME 不一致/超 8192 各一腿 + 全绿腿 + 拒路径零副作用腿 + 再水化三腿 +
 * 预算刀 image-ref 腿 + 压缩素材占位腿 + 装配桥四腿）。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { AssistantMessage as PiAssistantMessage } from '@earendil-works/pi-ai';

import type { ImageRefContent, LlmContext, Message, ModelInfo, UserMessage } from '../contracts/llm.js';
import { degradeImageRefsForMaterial } from '../compaction/policy.js';
import { createAttachmentStore } from '../persist/index.js';
import type { AttachmentStore } from '../persist/index.js';
import { truncateContent } from '../session/budget.js';
import type { ContentBlock } from '../session/event-data.js';
import { fauxProvider } from '../llm/index.js';
import type { Provider } from '../llm/index.js';

import { createConversationStack } from './conversation-stack.js';
import { createHostRuntime } from './runtime.js';
import type { HostRuntime } from './runtime.js';
import { mountWebuiOnFace } from './webui-bridge.js';
import { admitPasteImages, rehydrateImageRefsForLlm, AttachmentIntakeRejectionError } from './attachment-intake.js';
import type { IntakeCapabilityFace, PasteImageInput } from './attachment-intake.js';

/* ---------------- 测试基建 ---------------- */

/** 零用量（faux 响应脚本件） */
const NO_USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };

/** faux 响应脚本件（'ok' 文本终态） */
function messageOf(): PiAssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: 'ok' }],
    usage: NO_USAGE,
    stopReason: 'stop',
    timestamp: 1,
  } as unknown as PiAssistantMessage;
}

/** 临时目录族 */
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function rigDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

/** 微任务推进（write-behind 落账 / run 起跑等待） */
function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** 有界轮询等待（红锚须可终止——超时上限硬收） */
async function until(assert: () => boolean | Promise<boolean>, ms = 8000): Promise<void> {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await assert()) return;
    if (Date.now() > deadline) throw new Error('等待超时（until 轮询上限）');
    await tick();
  }
}

/**
 * 自铸 PNG fixture（零依赖——魔数嗅探读前 8 字节、宽高读 IHDR 偏移 16/20
 * 的大端 u32；CRC 不进受理链判据，零填占位）。任务钦定「自铸最小 PNG
 * fixture 字节——IHDR 1x1」。
 */
function pngWithDimensions(width: number, height: number): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  // 位深 8 / 彩色类型 6 / 压缩·滤波·隔行三零（宽高之外的字节不进判据）
  const chunk = Buffer.concat([Buffer.alloc(4), Buffer.from('IHDR', 'ascii'), ihdr]);
  chunk.writeUInt32BE(13, 0);
  return Buffer.concat([signature, chunk]);
}

/** 1x1 最小 PNG */
const MINIMAL_PNG = pngWithDimensions(1, 1);

/**
 * 自铸 JPEG fixture（fill 垫形——marker 前填充字节）：SOI 后垫 0xFF fill
 * 两枚再入 SOF0（灰度 1 分量 16×32；段长含自身两字节 = 2+1+2+2+1+3 = 11）。
 * JPEG 规范（ITU-T T.81）允许 marker 前任意数 0xFF 填充——真实编码器
 * （部分相机/扫描仪产出）会带该形；段扫描须逐字节消费 fill，不得把 fill
 * 后真 marker 字节误读成段长跳飞（挖掘 14 轮 P2-c 回归锁素材）。
 */
const JPEG_FILL_PAD = Buffer.from([
  0xff,
  0xd8, // SOI
  0xff,
  0xff, // fill 填充字节 ×2（T.81 marker 前填充）
  0xff,
  0xc0, // SOF0（fill 后真 marker）
  0x00,
  0x0b, // 段长 11（含自身两字节）
  0x08, // 精度 8
  0x00,
  0x10, // 高 16
  0x00,
  0x20, // 宽 32
  0x01, // 分量数 1（灰度）
  0x01,
  0x11,
  0x00, // 分量 1（id/采样因子/量化表选）
]);

/** 能力门查面铸造（input 声明缺席形 = modelInfoOf 回 undefined） */
function capabilityFace(input?: readonly ('text' | 'image')[]): IntakeCapabilityFace {
  const info: ModelInfo | undefined =
    input === undefined
      ? undefined
      : {
          id: 'faux-intake/m1',
          name: 'm1',
          provider: 'faux-intake',
          reasoning: false,
          input,
          contextWindow: 8192,
          maxTokens: 4096,
        };
  return { modelOf: () => 'faux-intake/m1', modelInfoOf: () => info };
}

/** 附件库 spy 胖面（零副作用断言供源——write 计数透传真身） */
function spyStore(base: AttachmentStore): { store: AttachmentStore; writes: { ext: string; bytes: number }[] } {
  const writes: { ext: string; bytes: number }[] = [];
  return {
    writes,
    store: {
      write: (bytes, ext) => {
        writes.push({ ext, bytes: bytes.byteLength });
        return base.write(bytes, ext);
      },
      read: (ref) => base.read(ref),
    },
  };
}

/** 粘贴图铸造速记 */
function imageOf(bytes: Buffer, mimeType = 'image/png'): PasteImageInput {
  return { data: bytes.toString('base64'), mimeType };
}

/** 受理拒捕获（骨架桩 plain Error 在 instanceof 位红——修前红锚判别点） */
function rejectionOf(admit: () => unknown): AttachmentIntakeRejectionError {
  try {
    admit();
  } catch (err) {
    expect(err).toBeInstanceOf(AttachmentIntakeRejectionError);
    const rej = err as AttachmentIntakeRejectionError;
    expect(rej.status).toBe(400);
    return rej;
  }
  throw new Error('期望受理拒未抛（受理链放行了应拒入参）');
}

/* ---------------- 受理链单元腿 ---------------- */

describe('attachment-intake 受理链（03 §10.4 ②）', () => {
  it('全绿腿：最小 PNG 铸 image-ref 引用块（ref 词法/落盘在场/幂等同 ref）+ 能力声明缺席不拦', () => {
    const store = createAttachmentStore(rigDir('intake-green-'));
    // 能力声明缺席（modelInfoOf → undefined）：能力门不拦——诚实失败不臆断
    const blocks = admitPasteImages({
      sessionId: 's-any',
      images: [imageOf(MINIMAL_PNG)],
      store,
      capability: capabilityFace(undefined),
    });
    expect(blocks).toHaveLength(1);
    const block = blocks[0]!;
    expect(block.type).toBe('image-ref');
    expect(block.ref).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(block.mimeType).toBe('image/png');
    expect(block.bytes).toBe(MINIMAL_PNG.byteLength);
    // 内容寻址文件在场 + 读回环（ext 由嗅探族派生——png）
    const record = store.read(block.ref);
    expect(record).not.toBeNull();
    expect(record!.bytes.equals(MINIMAL_PNG)).toBe(true);
    expect(record!.mimeType).toBe('image/png');
    // 同图重复受理：内容寻址幂等——同 ref（同图多会话引用同文件）
    const again = admitPasteImages({
      sessionId: 's-any',
      images: [imageOf(MINIMAL_PNG)],
      store,
      capability: capabilityFace(['text', 'image']),
    });
    expect(again[0]!.ref).toBe(block.ref);
  });

  it('能力门：模型 input 不含 image → 400 拒「当前模型不支持图片输入」+ 零副作用（写零调用）', () => {
    const base = createAttachmentStore(rigDir('intake-cap-'));
    const spy = spyStore(base);
    const rej = rejectionOf(() =>
      admitPasteImages({
        sessionId: 's-any',
        images: [imageOf(MINIMAL_PNG)],
        store: spy.store,
        capability: capabilityFace(['text']),
      }),
    );
    expect(rej.message).toContain('不支持图片输入');
    // 拒路径零副作用腿 A：能力门是链前置——落盘零调用
    expect(spy.writes).toHaveLength(0);
  });

  it('数量帽：5 件超 4 件/消息上限 → 400 拒（拷贝限值同源）', () => {
    const store = createAttachmentStore(rigDir('intake-count-'));
    const spy = spyStore(store);
    const rej = rejectionOf(() =>
      admitPasteImages({
        sessionId: 's-any',
        images: [
          imageOf(MINIMAL_PNG),
          imageOf(MINIMAL_PNG),
          imageOf(MINIMAL_PNG),
          imageOf(MINIMAL_PNG),
          imageOf(MINIMAL_PNG),
        ],
        store: spy.store,
        capability: capabilityFace(['text', 'image']),
      }),
    );
    expect(rej.message).toContain('最多');
    expect(spy.writes).toHaveLength(0);
  });

  it('坏 base64：非字母表字符 → 400 拒 + 逐件拒先于落盘（首件拒写零调用）', () => {
    const base = createAttachmentStore(rigDir('intake-b64-'));
    const spy = spyStore(base);
    const rej = rejectionOf(() =>
      admitPasteImages({
        sessionId: 's-any',
        images: [{ data: '不是有效的base64!!', mimeType: 'image/png' }],
        store: spy.store,
        capability: capabilityFace(['text', 'image']),
      }),
    );
    expect(rej.message).toContain('base64');
    // 拒路径零副作用腿 B：首件即拒——落盘零调用
    expect(spy.writes).toHaveLength(0);
  });

  it('字节帽：解码后超 5MiB → 400 拒（PNG 魔数前缀真字节——帽先于嗅探）', () => {
    const store = createAttachmentStore(rigDir('intake-bytes-'));
    const spy = spyStore(store);
    const big = Buffer.alloc(6 * 1024 * 1024, 0x00);
    MINIMAL_PNG.copy(big, 0);
    const rej = rejectionOf(() =>
      admitPasteImages({
        sessionId: 's-any',
        images: [imageOf(big)],
        store: spy.store,
        capability: capabilityFace(['text', 'image']),
      }),
    );
    expect(rej.message).toContain('太大');
    expect(spy.writes).toHaveLength(0);
  });

  it('魔数白名单：SVG 头字节（3C 73 76 67）四族外 → 400 拒（SVG 结构性禁入）', () => {
    const store = createAttachmentStore(rigDir('intake-magic-'));
    const spy = spyStore(store);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'utf8');
    const rej = rejectionOf(() =>
      admitPasteImages({
        sessionId: 's-any',
        images: [{ data: svg.toString('base64'), mimeType: 'image/svg+xml' }],
        store: spy.store,
        capability: capabilityFace(['text', 'image']),
      }),
    );
    expect(rej.message).toContain('格式');
    expect(spy.writes).toHaveLength(0);
  });

  it('MIME 声明不一致：PNG 魔数声明 image/jpeg → 400 拒（勿信声明——嗅探族核验）', () => {
    const store = createAttachmentStore(rigDir('intake-mime-'));
    const rej = rejectionOf(() =>
      admitPasteImages({
        sessionId: 's-any',
        images: [imageOf(MINIMAL_PNG, 'image/jpeg')],
        store,
        capability: capabilityFace(['text', 'image']),
      }),
    );
    expect(rej.message).toContain('不一致');
  });

  it('JPEG fill 垫字节：marker 前填充不误读段长跳飞 → 受理成功（挖掘 14 轮 P2-c——修前红：误报数据不完整拒）', () => {
    const store = createAttachmentStore(rigDir('intake-fill-'));
    const blocks = admitPasteImages({
      sessionId: 's-any',
      images: [imageOf(JPEG_FILL_PAD, 'image/jpeg')],
      store,
      capability: capabilityFace(['text', 'image']),
    });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.type).toBe('image-ref');
    expect(blocks[0]!.mimeType).toBe('image/jpeg');
  });

  it('尺寸帽：宽 8193 超 8192 任一边上限 → 400 拒（零依赖 IHDR 头解析）', () => {
    const store = createAttachmentStore(rigDir('intake-dim-'));
    const rej = rejectionOf(() =>
      admitPasteImages({
        sessionId: 's-any',
        images: [imageOf(pngWithDimensions(8193, 1))],
        store,
        capability: capabilityFace(['text', 'image']),
      }),
    );
    expect(rej.message).toContain('尺寸');
  });

  it('附件库缺席（内存模式数据目录 null）+ images 非空 → 400 拒（不臆造存储）', () => {
    const rej = rejectionOf(() =>
      admitPasteImages({
        sessionId: 's-any',
        images: [imageOf(MINIMAL_PNG)],
        store: undefined,
        capability: capabilityFace(['text', 'image']),
      }),
    );
    expect(rej.message).toContain('数据目录');
  });

  it('空数组早退：images 空即零副作用直返（能力面/存储面均不可达——零漂移护栏）', () => {
    const blocks = admitPasteImages({
      sessionId: 's-any',
      images: [],
      store: undefined,
      // 能力面本腿不可达——注入抛错面证早退先于能力门
      capability: {
        modelOf: () => {
          throw new Error('能力面不可达（空数组早退护栏红）');
        },
        modelInfoOf: () => {
          throw new Error('能力面不可达（空数组早退护栏红）');
        },
      },
    });
    expect(blocks).toEqual([]);
  });
});

/* ---------------- 再水化单元腿（03 §10.4 ⑤ 单点） ---------------- */

describe('attachment-intake 再水化（convertToLlm 消费位）', () => {
  it('还原腿：image-ref 块读附件库还原 ImageContent base64（邻块原样保序）', () => {
    const store = createAttachmentStore(rigDir('rehydrate-ok-'));
    const written = store.write(MINIMAL_PNG, 'png');
    const refBlock: ImageRefContent = {
      type: 'image-ref',
      ref: written.ref,
      mimeType: 'image/png',
      bytes: MINIMAL_PNG.byteLength,
    };
    const message: Message = {
      role: 'user',
      content: [{ type: 'text', text: '看这张图' }, refBlock],
      timestamp: 1,
    };
    const out = rehydrateImageRefsForLlm(message, store);
    const content = (out as UserMessage).content;
    expect(Array.isArray(content)).toBe(true);
    const blocks = content as { type: string }[];
    expect(blocks[0]).toEqual({ type: 'text', text: '看这张图' });
    expect(blocks[1]).toEqual({
      type: 'image',
      data: MINIMAL_PNG.toString('base64'),
      mimeType: 'image/png',
    });
  });

  it('文件缺席降级腿：ref 词法好形但附件不在场 → 「[图片已不可用]」文本占位（store 缺席/坏形 ref 同律）', () => {
    const store = createAttachmentStore(rigDir('rehydrate-miss-'));
    const missingRef: ImageRefContent = {
      type: 'image-ref',
      ref: `sha256:${'a'.repeat(64)}`,
      mimeType: 'image/png',
      bytes: 1,
    };
    // ① store 在场、文件缺席
    const outA = rehydrateImageRefsForLlm({ role: 'user', content: [missingRef], timestamp: 1 }, store) as UserMessage;
    expect(outA.content).toEqual([{ type: 'text', text: '[图片已不可用]' }]);
    // ② store 整体缺席（内存模式）：同降级律
    const outB = rehydrateImageRefsForLlm(
      { role: 'user', content: [missingRef], timestamp: 1 },
      undefined,
    ) as UserMessage;
    expect(outB.content).toEqual([{ type: 'text', text: '[图片已不可用]' }]);
    // ③ 坏形 ref（read throw 形）：再水化不炸 run——同降级律
    const badRef: ImageRefContent = { type: 'image-ref', ref: '../穿越', mimeType: 'image/png', bytes: 1 };
    const outC = rehydrateImageRefsForLlm({ role: 'user', content: [badRef], timestamp: 1 }, store) as UserMessage;
    expect(outC.content).toEqual([{ type: 'text', text: '[图片已不可用]' }]);
  });

  it('恒等快路径：无引用块的消息原引用直返（零分配零漂移——assistant/纯文本同律）', () => {
    const store = createAttachmentStore(rigDir('rehydrate-fast-'));
    const userText: Message = { role: 'user', content: '纯文本', timestamp: 1 };
    expect(rehydrateImageRefsForLlm(userText, store)).toBe(userText);
    const userBlocks: Message = {
      role: 'user',
      content: [{ type: 'text', text: '无图块' }],
      timestamp: 1,
    };
    expect(rehydrateImageRefsForLlm(userBlocks, store)).toBe(userBlocks);
    const assistant: Message = {
      role: 'assistant',
      content: [{ type: 'text', text: 'ok' }],
      usage: NO_USAGE,
      stopReason: 'stop',
      timestamp: 1,
    };
    expect(rehydrateImageRefsForLlm(assistant, store)).toBe(assistant);
  });
});

/* ---------------- 预算刀 image-ref 腿（05 §1.2 条 4 注——引用块恒过刀） ---------------- */

describe('session/budget image-ref 块（百字节级恒过 60KiB 刀）', () => {
  const refBlock = {
    type: 'image-ref',
    ref: `sha256:${'0'.repeat(64)}`,
    mimeType: 'image/png',
    bytes: 29,
  } as unknown as ContentBlock;

  it('快路径：仅引用块消息总量有限计量——原引用直返（修前 blockBytes 无 case → NaN/崩溃）', () => {
    // 修前红：blockBytes(image-ref) 返回 undefined → total=NaN → 快路径假
    // → 慢路径取 block.thinking=undefined → Buffer.byteLength(undefined) 抛
    // ERR_INVALID_ARG_TYPE（session.ts:135 append 流水线步 4 全量可达）
    const arr = [refBlock];
    expect(truncateContent(arr)).toBe(arr);
  });

  it('慢路径：邻块超帽截断时引用块原样保留（不落 image-blob-dropped 占位）', () => {
    const bigText = { type: 'text', text: '长'.repeat(70 * 1024) } as ContentBlock;
    const out = truncateContent([refBlock, bigText]);
    expect(Array.isArray(out)).toBe(true);
    const blocks = out as ContentBlock[];
    // 引用块百字节级——预算容得下原样保留（占位律只辖内联 base64 image 块）
    expect(blocks.some((b) => (b.type as string) === 'image-ref')).toBe(true);
    // 超帽文本块被截断（尾标记在场）
    const textOut = blocks.find((b) => b.type === 'text') as { text: string };
    expect(textOut.text).toContain('truncated');
  });
});

/* ---------------- 压缩素材占位腿（05 §3.1 同批注——非会话请求面 [图片] 占位） ---------------- */

describe('compaction 素材 image-ref 占位（degradeImageRefsForMaterial）', () => {
  it('image-ref 块降 [图片] 文本占位 + 无引用块素材恒等直返', () => {
    const refBlock = {
      type: 'image-ref',
      ref: `sha256:${'1'.repeat(64)}`,
      mimeType: 'image/png',
      bytes: 29,
    };
    const withRef = [
      { type: 'user', seq: 1, content: [{ type: 'text', text: '看图' }, refBlock] },
      { type: 'assistant', seq: 2, content: [{ type: 'text', text: 'ok' }] },
    ] as unknown as Parameters<typeof degradeImageRefsForMaterial>[0];
    const out = degradeImageRefsForMaterial(withRef);
    const user = out[0] as unknown as { content: { type: string; text?: string }[] };
    expect(user.content[0]).toEqual({ type: 'text', text: '看图' });
    expect(user.content[1]).toEqual({ type: 'text', text: '[图片]' });
    // assistant 行原样（浅替换不深改无涉行）
    expect(out[1]).toBe(withRef[1]);
    // 无引用块素材：恒等直返（零分配零漂移）
    const plain = [{ type: 'user', seq: 1, content: '纯文本' }] as unknown as Parameters<
      typeof degradeImageRefsForMaterial
    >[0];
    expect(degradeImageRefsForMaterial(plain)).toBe(plain);
  });
});

/* ---------------- 装配桥接线腿（submitPrompt images 位全链） ---------------- */

/** 真栈速记（faux provider 可注入 input 声明——能力门腿用 ['text'] 形） */
function rigStack(rt: HostRuntime, input?: ('text' | 'image')[]) {
  const faux = fauxProvider({
    provider: 'faux-intake',
    models: [{ id: 'm1', ...(input !== undefined ? { input } : {}) }],
  });
  const stack = createConversationStack({
    runtime: rt,
    providers: [faux.provider] as readonly Provider[],
    model: 'faux-intake/m1',
    env: {},
  });
  return { faux, stack };
}

/** 桩承载面（mountWebuiOnFace 只消费 face.register——零监听零 TCP） */
function stubFace(): Parameters<typeof mountWebuiOnFace>[0]['face'] {
  return {
    register: () => () => {},
  } as unknown as Parameters<typeof mountWebuiOnFace>[0]['face'];
}

describe('webui 装配桥 submitPrompt images 接线（03 §10.4 ②→⑤ 全链）', () => {
  it('全链腿：images 过受理链铸引用块落 durable（投影恒引用形）→ convertToLlm 再水化 base64 进请求', async () => {
    const rt = createHostRuntime({ dataDir: rigDir('wire-full-') });
    const { faux, stack } = rigStack(rt);
    const captured: LlmContext[] = [];
    faux.setResponses([
      (context) => {
        captured.push(context as unknown as LlmContext);
        return messageOf();
      },
    ]);
    const mount = mountWebuiOnFace({ stack, face: stubFace() });
    try {
      const sessionId = mount.deps.sessions.createSession();
      const receipt = mount.deps.sessions.submitPrompt({
        sessionId,
        content: '看这张图',
        messageId: undefined,
        images: [imageOf(MINIMAL_PNG)],
      });
      expect(receipt.sessionId).toBe(sessionId);
      // run 起跑 → faux 工厂捕获请求上下文（模型侧看到的是再水化后的 base64）
      await until(() => captured.length > 0);
      await until(async () => (await stack.projectionOf(sessionId)).some((m) => m.role === 'assistant'));
      // 驱动会注入 <environment> 瞬态 user 消息——扫块数组形取本例消息
      const lastUser = captured[0]!.messages
        .filter((m) => m.role === 'user' && Array.isArray(m.content))
        .at(-1) as UserMessage;
      expect(Array.isArray(lastUser.content)).toBe(true);
      const blocks = lastUser.content as { type: string }[];
      expect(blocks[0]).toEqual({ type: 'text', text: '看这张图' });
      expect(blocks[1]).toEqual({
        type: 'image',
        data: MINIMAL_PNG.toString('base64'),
        mimeType: 'image/png',
      });
      // durable/投影恒引用形（重播种侧零改的结构性依据）
      const events = stack.driverOf(sessionId)!.session.events();
      const userEvent = events.find((e) => e.type === 'user/message');
      expect(userEvent).toBeDefined();
      const durableBlocks = (userEvent!.data as { content: unknown }).content as { type: string; ref?: string }[];
      expect(durableBlocks[0]).toEqual({ type: 'text', text: '看这张图' });
      expect(durableBlocks[1]!.type).toBe('image-ref');
      expect(durableBlocks[1]!.ref).toMatch(/^sha256:[0-9a-f]{64}$/);
      // 附件库真落盘（再水化供源 = 同一 store 实例）
      expect(stack.attachments).toBeDefined();
      const record = stack.attachments!.read(durableBlocks[1]!.ref!);
      expect(record!.bytes.equals(MINIMAL_PNG)).toBe(true);
      // 投影读面同持引用形（GET /messages 腿结构性同源）
      const projection = await stack.projectionOf(sessionId);
      const projectedUser = projection.find((m) => m.role === 'user') as UserMessage;
      expect((projectedUser.content as { type: string }[]).some((b) => b.type === 'image-ref')).toBe(true);
    } finally {
      mount.detach();
      await rt.shutdown();
    }
  });

  it('能力门腿：faux 模型 input=["text"] → submitPrompt images 受理拒上抛（status 400）', async () => {
    const rt = createHostRuntime({ dataDir: rigDir('wire-cap-') });
    const { stack } = rigStack(rt, ['text']);
    const mount = mountWebuiOnFace({ stack, face: stubFace() });
    try {
      const sessionId = mount.deps.sessions.createSession();
      expect(() =>
        mount.deps.sessions.submitPrompt({
          sessionId,
          content: '看这张图',
          messageId: undefined,
          images: [imageOf(MINIMAL_PNG)],
        }),
      ).toThrow(AttachmentIntakeRejectionError);
      // 拒路径零副作用辖 durable 会话面：无 user/message 落账
      expect(
        stack
          .driverOf(sessionId)!
          .session.events()
          .some((e) => e.type === 'user/message'),
      ).toBe(false);
    } finally {
      mount.detach();
      await rt.shutdown();
    }
  });

  it('image-only 腿：空文本 + images 合法——不铸空文本块、请求侧单图块', async () => {
    const rt = createHostRuntime({ dataDir: rigDir('wire-only-') });
    const { faux, stack } = rigStack(rt);
    const captured: LlmContext[] = [];
    faux.setResponses([
      (context) => {
        captured.push(context as unknown as LlmContext);
        return messageOf();
      },
    ]);
    const mount = mountWebuiOnFace({ stack, face: stubFace() });
    try {
      const sessionId = mount.deps.sessions.createSession();
      mount.deps.sessions.submitPrompt({
        sessionId,
        content: '',
        messageId: undefined,
        images: [imageOf(MINIMAL_PNG)],
      });
      await until(() => captured.length > 0);
      await until(async () => (await stack.projectionOf(sessionId)).some((m) => m.role === 'assistant'));
      // 扫块数组形取本例消息（<environment> 瞬态注入不扰）
      const lastUser = captured[0]!.messages
        .filter((m) => m.role === 'user' && Array.isArray(m.content))
        .at(-1) as UserMessage;
      const blocks = lastUser.content as { type: string }[];
      // 请求侧：恰一图块（无空文本块）
      expect(blocks).toHaveLength(1);
      expect(blocks[0]!.type).toBe('image');
      // durable 侧：恰一引用块
      const events = stack.driverOf(sessionId)!.session.events();
      const userEvent = events.find((e) => e.type === 'user/message');
      const durableBlocks = (userEvent!.data as { content: unknown }).content as { type: string }[];
      expect(durableBlocks).toHaveLength(1);
      expect(durableBlocks[0]!.type).toBe('image-ref');
    } finally {
      mount.detach();
      await rt.shutdown();
    }
  });

  it('零漂移腿：images 缺席 = 既有提交流原样（string 直通——请求侧纯文本）', async () => {
    const rt = createHostRuntime({ dataDir: rigDir('wire-plain-') });
    const { faux, stack } = rigStack(rt);
    const captured: LlmContext[] = [];
    faux.setResponses([
      (context) => {
        captured.push(context as unknown as LlmContext);
        return messageOf();
      },
    ]);
    const mount = mountWebuiOnFace({ stack, face: stubFace() });
    try {
      const sessionId = mount.deps.sessions.createSession();
      mount.deps.sessions.submitPrompt({ sessionId, content: '纯文本', messageId: undefined });
      await until(async () => (await stack.projectionOf(sessionId)).some((m) => m.role === 'assistant'));
      // 纯文本消息 = string 直通（零漂移；<environment> 瞬态注入不扰——按内容锚取）
      const plainUser = captured[0]!.messages.find((m) => m.role === 'user' && m.content === '纯文本');
      expect(plainUser).toBeDefined();
    } finally {
      mount.detach();
      await rt.shutdown();
    }
  });
});
