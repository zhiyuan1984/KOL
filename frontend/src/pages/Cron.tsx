import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";

const CRON_JOB_TITLE = "失联与延期扫描";

type CronItem = { handle: string; days_in_stage: number };

function jobTitle(raw?: string): string {
  const text = String(raw || "").trim();
  if (!text || /\bT8\b/i.test(text)) return CRON_JOB_TITLE;
  return text.replace(/\s*T8\s*/gi, "").replace(/^失联与延期扫描.*/, CRON_JOB_TITLE) || CRON_JOB_TITLE;
}

export default function Cron() {
  const [items, setItems] = useState<CronItem[]>([]);
  const [title, setTitle] = useState(CRON_JOB_TITLE);
  const [loadState, setLoadState] = useState<"loading" | "ok" | "error">("loading");
  const [error, setError] = useState("");
  const nav = useNavigate();

  useEffect(() => {
    api.cron()
      .then((data: { p0?: string; items?: CronItem[] }) => {
        setTitle(jobTitle(data?.p0));
        setItems(Array.isArray(data?.items) ? data.items : []);
        setLoadState("ok");
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "无法加载定时任务");
        setLoadState("error");
      });
  }, []);

  const scan = async () => {
    const r = (await api.riskScan()) as { session_id: string };
    const ses = r.session_id;
    await api.postMessage(ses, { text: "扫描在途风险", intent: "risk_scan" });
    nav(`/s/${ses}`);
  };

  return (
    <div className="list-page" data-cron-page>
      <div>
        <div className="page-kicker">定时</div>
        <h1>定时任务</h1>
        <p className="muted">今天或按点要跑的自动化。默认是失联与延期扫描。</p>
      </div>
      <div className="panel" data-cron-job="overdue-scan">
        <h3>{title}</h3>
        {loadState === "loading" && <p className="muted" data-cron-state="loading">正在加载…</p>}
        {loadState === "error" && <p className="error" role="alert" data-cron-state="error">{error}</p>}
        {loadState === "ok" && items.length === 0 && (
          <p className="muted" data-cron-state="empty">当前没有需要扫描的在途合作。</p>
        )}
        {items.map((i) => (
          <p key={i.handle} className="muted" data-cron-item={i.handle}>
            @{i.handle} · 已停留 {i.days_in_stage} 天
          </p>
        ))}
        <button className="btn work" onClick={() => void scan()}>
          跑一次风险扫描
        </button>
      </div>
    </div>
  );
}
