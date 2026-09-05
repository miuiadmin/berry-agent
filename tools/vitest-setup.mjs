import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';

/**
 * vitest setupFiles（每测试文件执行一次；承 berry 基建大扫 #16 形态）：
 * 强制 BERRY_AGENT_DATA_DIR 到临时根——测试永不写真 ~/.berry-agent。
 *
 * 语义要点：
 * - 只在测试未自钉时钉扎（显式 process.env.BERRY_AGENT_DATA_DIR 赋值晚于
 *   setup 生效、行为不变）；哨兵 BERRY_AGENT_TEST_PINNED_DATA_DIR 标记
 *   「本 setup 是钉扎者」，文件级 afterAll 负责清理。
 * - 缺省值语义自洽：宿主缺省数据目录解析若读 env，临时根即拦截一切
 *   落盘路径；纯逻辑测试不受影响。
 */
if (!process.env.BERRY_AGENT_DATA_DIR) {
  const pinned = mkdtempSync(join(tmpdir(), 'berry-agent-test-'));
  process.env.BERRY_AGENT_DATA_DIR = pinned;
  process.env.BERRY_AGENT_TEST_PINNED_DATA_DIR = pinned;

  afterAll(() => {
    // 本 setup 钉的临时根由本 setup 清（测试自钉的自理）——recursive 兜底
    // 残留文件，force 吞「已不存在」。
    rmSync(pinned, { recursive: true, force: true });
    delete process.env.BERRY_AGENT_DATA_DIR;
    delete process.env.BERRY_AGENT_TEST_PINNED_DATA_DIR;
  });
}
