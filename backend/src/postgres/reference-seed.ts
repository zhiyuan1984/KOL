import { builtinConnectorRows, DEFAULT_KNOWLEDGE_BASES, DEFAULT_KNOWLEDGE_DOMAINS } from "../reference-data.js";
import { pgTransaction } from "./access.js";

/** Versioned schema is installed separately. This only seeds missing reference rows. */
export async function seedPostgresReferenceData(): Promise<{ connectors: number; domains: number; bases: number }> {
  const connectors = builtinConnectorRows();
  await pgTransaction(async (db) => {
    const stamp = new Date().toISOString();
    for (const connector of connectors) {
      await db.execute(`INSERT INTO connectors (id,label,purpose,enabled,status,credential_ref,updated_at)
        VALUES ($1,$2,$3,0,'draft',NULL,$4) ON CONFLICT (id) DO NOTHING`,
        connector.id, connector.label, connector.purpose, stamp);
    }
    for (const domain of DEFAULT_KNOWLEDGE_DOMAINS) {
      await db.execute(`INSERT INTO knowledge_domains (id,code,name,level,parent_id,sort,status,created_at,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$7) ON CONFLICT (id) DO NOTHING`,
        domain.id, domain.code, domain.name, domain.level, domain.parent_id, domain.sort, stamp);
    }
    for (const base of DEFAULT_KNOWLEDGE_BASES) {
      await db.execute(`INSERT INTO knowledge_bases (id,code,name,domain_id,kind,description,status,settings,version,created_at,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$8,$9,$9) ON CONFLICT (id) DO NOTHING`,
        base.id, base.code, base.name, base.domain_id, base.kind, base.description, base.settings, base.version, stamp);
    }
  });
  return { connectors: connectors.length, domains: DEFAULT_KNOWLEDGE_DOMAINS.length, bases: DEFAULT_KNOWLEDGE_BASES.length };
}
