import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, type StarryBinding } from "../api";
import {
  connectorUseLabel,
  connectorUseMeaning,
  connectorUseStatus,
  preferCanonicalConnectors,
} from "../connectorUse";

export default function ConnectorUse() {
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [binding, setBinding] = useState<StarryBinding | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      api.connectors(),
      api.starryBinding().catch(() => ({ bound: false, status: "unbound" } as StarryBinding)),
    ])
      .then(([list, bind]) => {
        if (cancelled) return;
        setRows(Array.isArray(list) ? list : []);
        setBinding(bind);
      })
      .catch((e) => {
        if (cancelled) return;
        setRows([]);
        setError(e instanceof Error ? e.message : "无法读取已授权的连接能力");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const items = useMemo(() => {
    if (!rows) return [];
    return preferCanonicalConnectors(
      rows
        .map((row) => {
          const id = String(row.id || "");
          if (!id) return null;
          return {
            id,
            label: connectorUseLabel(id, row.label || row.name),
            meaning: connectorUseMeaning(id),
            status: connectorUseStatus(id, binding),
          };
        })
        .filter((row): row is NonNullable<typeof row> => Boolean(row)),
    );
  }, [binding, rows]);

  return (
    <div className="list-page connector-use-page" data-connector-use data-visual="docs20">
      <div>
        <div className="page-kicker">账户</div>
        <h1 style={{ marginTop: 0 }}>连接器</h1>
        <p className="muted">
          你已被授权可用哪些连接能力、对你意味着什么。启用、凭据和组织策略不在本页。
        </p>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {rows === null && !error && <p className="muted">正在读取已授权的连接能力…</p>}
      {rows && items.length === 0 && !error && (
        <p className="muted" data-connector-use-empty>
          目前没有已授权给你的连接能力。需要开通请联系管理员。
        </p>
      )}
      {items.length > 0 && (
        <div className="connector-use-list" role="list">
          {items.map((item) => (
            <article
              key={item.id}
              className="connector-use-row"
              data-connector-use-row={item.id}
              data-connector-use-status={item.status.key}
              role="listitem"
            >
              <div>
                <strong>{item.label}</strong>
                <p className="muted">{item.meaning}</p>
              </div>
              <div className="connector-use-aside">
                <span className="connector-use-status" data-status={item.status.key}>
                  {item.status.label}
                </span>
                {item.status.key === "needs_personal_bind" && (
                  <Link className="btn ghost sm" to="/settings?tab=starry" data-connector-use-bind>
                    去个人设置绑定
                  </Link>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      <p className="muted" data-connector-use-bind-hint>
        跟进邮箱在
        {" "}
        <Link to="/settings?tab=starry">个人设置</Link>
        {" "}
        按人绑定。本页不接收密钥，也不表示远端已经接通。
      </p>
    </div>
  );
}
