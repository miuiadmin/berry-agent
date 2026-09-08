/**
 * credentials 表扩容迁移（迁移 v7——c-2 存储腿占号；05 §6.4「号随注册序
 * 顺延」：scheduler v2 / goal v3 / memory v4-v6 之后本件占 v7）。
 *
 * 扩形（03 §10.9 存储 bullet + 05 §9 表行——同表扩容·裁决②形态 A）：
 *   - 加 namespace 列（TEXT NOT NULL DEFAULT 'host'）——归属列；
 *   - 主键 provider → (namespace, provider) 复合（SQLite 不能原地改主键，
 *     走重建四步舞：建新表 → 回填 → 弃旧表 → 改名）；
 *   - 既有行回填 'host'（模型 API key 射程界桩——v1 表即其终态，扩容后
 *     语义不变）；
 *   - 密文盒/备份面/迁移链全复用（对手模型不变：防密文单独泄露）。
 */
import type { MigrationSpec } from '../persist/index.js';

export const CREDENTIALS_MIGRATION: MigrationSpec = {
  version: 7,
  name: 'credentials-namespace',
  sql: `
    CREATE TABLE credentials_v7 (
      namespace  TEXT    NOT NULL DEFAULT 'host',        -- 归属列（'host' | 'plugin:<id>'——词面单源 src/credentials/types.ts）
      provider   TEXT    NOT NULL,                       -- 作用名（读腿 get(name) 的 name——物理列名承 v1）
      api_key    TEXT    NOT NULL,                       -- v1:<base64(iv|tag|ct)>（secret-box 加密产物）
      meta       TEXT,                                   -- JSON 附加元数据（source/expired 键约定见 types.ts）
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (namespace, provider)
    ) STRICT;
    INSERT INTO credentials_v7 (namespace, provider, api_key, meta, updated_at)
      SELECT 'host', provider, api_key, meta, updated_at FROM credentials;
    DROP TABLE credentials;
    ALTER TABLE credentials_v7 RENAME TO credentials;
  `,
};
