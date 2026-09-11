import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";

export default function Cron() {
  const [data, setData] = useState<{ p0: string; items: { handle: string; stage_label: string; days_in_stage: number }[] } | null>(null);
  const nav = useNavigate();
  useEffect(() => {
    api.cron().then(setData as never);
  }, []);
  const scan = async () => {
    const r = (await api.riskScan()) as { session_id: string };
    const ses = r.session_id;
    await api.postMessage(ses, { text: "扫描在途风险", intent: "risk_scan" });
    nav(`/s/${ses}`);
  };
  return (
    <div className="list-page">
      <div>
        <div className="page-kicker">我的</div>
        <h1 style={{ marginTop: 0 }}>定时任务</h1>
        <p className="muted">P0 仅 T8 失联与延期扫描。不接经营早报 / 加班审批。</p>
      </div>
      <div className="panel">
        <h3>{data?.p0 || "T8"}</h3>
        {(data?.items || []).map((i) => (
          <p key={i.handle} className="muted">
            @{i.handle} · {i.stage_label} · {i.days_in_stage} 天
          </p>
        ))}
        <button className="btn work" onClick={scan}>
          跑一次风险扫描
        </button>
      </div>
    </div>
  );
}
