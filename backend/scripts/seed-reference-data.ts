/**
 * 写入新环境必需的参考数据（连接器目录、默认知识分类）——**PostgreSQL 侧唯一来源**。
 *
 * 这两项此前只由 `db.ts` 的 `migrateSchema`（SQLite 专属）用 app_state 门控回填，
 * 而 PG 不跑 migrateSchema，导致新建的 PG 库缺数据（表现为「没有可用的结构化知识库」）。
 * 幂等：可重复执行；已存在的行只更新标签/用途，不覆盖 enabled/status 等运行状态。
 *
 * 用法：DATABASE_URL=... npx tsx scripts/seed-reference-data.ts
 */
import { Client } from "pg";
import { DEFAULT_KNOWLEDGE_BASES, DEFAULT_KNOWLEDGE_DOMAINS, builtinConnectorRows } from "../src/reference-data.js";

const databaseUrl = String(process.env.DATABASE_URL || "").trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required to seed reference data");

const client = new Client({ connectionString: databaseUrl });
await client.connect();
try {
  await client.query("BEGIN");
  const stamp = new Date().toISOString();
  const connectors = builtinConnectorRows();
  for (const connector of connectors) {
    await client.query(
      `INSERT INTO connectors (id,label,purpose,enabled,status,credential_ref,updated_at)
       VALUES ($1,$2,$3,0,'draft',NULL,$4)
       ON CONFLICT (id) DO UPDATE SET label=EXCLUDED.label, purpose=EXCLUDED.purpose, updated_at=EXCLUDED.updated_at`,
      [connector.id, connector.label, connector.purpose, stamp],
    );
  }
  for (const domain of DEFAULT_KNOWLEDGE_DOMAINS) {
    await client.query(
      `INSERT INTO knowledge_domains (id,code,name,level,parent_id,sort,status,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$7)
       ON CONFLICT (id) DO NOTHING`,
      [domain.id, domain.code, domain.name, domain.level, domain.parent_id, domain.sort, stamp],
    );
  }
  for (const base of DEFAULT_KNOWLEDGE_BASES) {
    await client.query(
      `INSERT INTO knowledge_bases (id,code,name,domain_id,kind,description,status,settings,version,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$8,$9,$9)
       ON CONFLICT (id) DO NOTHING`,
      [base.id, base.code, base.name, base.domain_id, base.kind, base.description, base.settings, base.version, stamp],
    );
  }
  await client.query("COMMIT");
  console.log(JSON.stringify({ connectors: connectors.length, domains: DEFAULT_KNOWLEDGE_DOMAINS.length, bases: DEFAULT_KNOWLEDGE_BASES.length, database: "postgres" }));
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
