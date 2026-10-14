import type { Row } from "../types.js";
import { postgresQuery, postgresTransaction } from "./pool.js";
export async function pgListConnectorPermissions(userId: string): Promise<Record<string, string>> {
    const rows = await postgresQuery<{
        connector_id: string;
        access: string;
    }>("SELECT g.connector_id,g.access FROM user_connector_grants g JOIN connectors c ON c.id=g.connector_id WHERE g.user_id=$1 AND c.enabled=1", [userId]);
    return Object.fromEntries(rows.map(row => [String(row.connector_id), String(row.access)]));
}
export async function pgListConnectors(): Promise<Row[]> { return (await postgresQuery<Row>("SELECT * FROM connectors ORDER BY lower(label),id")); }
export async function pgCreateConnector(input: {
    id: string;
    label: string;
    purpose: string;
    protocol: string | null;
    now: string;
}): Promise<Row> { const rows = await postgresQuery<Row>("INSERT INTO connectors(id,label,purpose,enabled,status,credential_ref,declared_protocol,updated_at) VALUES($1,$2,$3,0,'draft',NULL,$4,$5) RETURNING *", [input.id, input.label, input.purpose, input.protocol, input.now]); return rows[0]; }
export async function pgUpdateConnector(id: string, changes: Record<string, unknown>): Promise<Row | undefined> {
    const allowed = new Set(["label", "purpose", "status", "credential_ref", "enabled"]);
    const entries = Object.entries(changes).filter(([k]) => allowed.has(k));
    if (!entries.length)
        return undefined;
    const values = entries.map(([, v]) => v);
    const sets = entries.map(([k], i) => `${k}=$${i + 1}`);
    sets.push(`updated_at=$${values.length + 1}`);
    values.push(new Date().toISOString());
    values.push(id);
    const rows = await postgresQuery<Row>(`UPDATE connectors SET ${sets.join(",")} WHERE id=$${values.length} RETURNING *`, values);
    return rows[0];
}
export async function pgDeleteConnector(id: string): Promise<boolean> { const rows = await postgresQuery("DELETE FROM connectors WHERE id=$1 RETURNING id", [id]); return rows.length > 0; }
export async function pgConnectorById(id: string): Promise<Row | undefined> { const [row] = await postgresQuery<Row>("SELECT * FROM connectors WHERE id=$1", [id]); return row; }
export async function pgRequireConnectorAccess(userId: string, connectorId: string, access: string): Promise<boolean> {
    const [row] = await postgresQuery<Row>("SELECT c.enabled,g.access FROM connectors c JOIN user_connector_grants g ON g.connector_id=c.id WHERE c.id=$1 AND g.user_id=$2", [connectorId, userId]);
    if (!row || !row.enabled)
        return false;
    const levels: {
        [key: string]: number;
    } = { read: 1, write: 2, admin: 3 };
    return (levels[String(row.access)] || 0) >= (levels[access] || 0);
}
export async function pgReplaceConnectorAuthorization(userId: string, connectorId: string, access: string, now: string): Promise<void> { await postgresQuery("INSERT INTO user_connector_grants(user_id,connector_id,access,created_at) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,connector_id) DO UPDATE SET access=EXCLUDED.access", [userId, connectorId, access, now]); }
