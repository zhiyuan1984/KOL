import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import type { SessionRow } from "../api";
import { memoryDeleteConfirm, sessionDeleteConfirm } from "../adminConfirm";
import { useAccount } from "../components/AuthGate";
import { useAdminConfirm } from "../components/ConfirmDialog";
import StarryBindForm from "../components/StarryBindForm";
import { dataSummaryLabel, formatDataSummaryValue } from "../labels";
import {
  formatSettingsReceiptTime,
  readSettingsReceipt,
  writeSettingsReceipt,
  type SettingsReceipt,
} from "../settingsReceipt";

type Memory = { id?: string; title?: string; body_md?: string; enabled?: boolean; scope?: string; version?: number };

const defaults = {
  theme: "system",
  locale: "zh-CN",
  model_tier: "balanced",
  default_brand: "",
  default_mailbox: "",
  notifications: true,
  left_sidebar_collapsed: false,
  right_workbench_collapsed: false,
  analytics_cookies: false,
};

export default function AccountSettings() {
  const { account, refresh } = useAccount();
  const [params, setParams] = useSearchParams();
  const requested = params.get("tab") || "profile";
  const [tab, setTab] = useState(requested);
  useEffect(() => {
    if (requested && requested !== tab) setTab(requested);
  }, [requested]); // eslint-disable-line react-hooks/exhaustive-deps
  const [preferences, setPreferences] = useState<Record<string, unknown>>(defaults);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [summary, setSummary] = useState<Record<string, unknown>>({});
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [cookies, setCookies] = useState<Record<string, unknown>>({});
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<SettingsReceipt | null>(() => readSettingsReceipt());
  const { ask, dialog } = useAdminConfirm();

  const recordReceipt = (next: Omit<SettingsReceipt, "at">) => {
    setReceipt(writeSettingsReceipt(next));
  };

  useEffect(() => {
    api.preferences().then((p) => setPreferences({ ...defaults, ...p })).catch(() => undefined);
    api.memories().then((m) => setMemories(m as Memory[])).catch(() => undefined);
    api.dataSummary().then(setSummary).catch(() => undefined);
    api.sessions(true).then(setSessions).catch(() => undefined);
    api.cookiePrivacy().then(setCookies).catch(() => undefined);
  }, []);

  const run = async (fn: () => Promise<unknown>, message: string) => {
    setError("");
    try {
      await fn();
      setNotice(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    }
  };

  const openTab = (id: string) => {
    setTab(id);
    const next = new URLSearchParams(params);
    if (id === "profile") next.delete("tab");
    else next.set("tab", id);
    setParams(next, { replace: true });
  };
  const tabs = [["profile", "个人资料"], ["starry", "连接 Starry"], ["preferences", "偏好"], ["security", "密码"], ["memories", "记忆"], ["privacy", "隐私与数据"]];
  return (
    <div className="settings-page">
      <div className="page-kicker">账户</div>
      <h1>个人设置</h1>
      <div className="settings-tabs" role="tablist" aria-label="设置分类">
        {tabs.map(([id, label]) => <button key={id} className={tab === id ? "active" : ""} role="tab" aria-selected={tab === id} onClick={() => openTab(id)}>{label}</button>)}
      </div>
      {receipt && (
        <aside className="settings-receipt" data-settings-receipt={receipt.kind} role="status">
          <p className="settings-receipt-kicker">最近一次确认操作{receipt.at ? ` · ${formatSettingsReceiptTime(receipt.at)}` : ""}</p>
          <p data-settings-receipt-text>{receipt.text}</p>
          <dl>
            <div>
              <dt>对象</dt>
              <dd data-settings-receipt-object>{receipt.object}</dd>
            </div>
            <div>
              <dt>范围</dt>
              <dd data-settings-receipt-scope>{receipt.scope}</dd>
            </div>
            <div>
              <dt>后果</dt>
              <dd data-settings-receipt-consequence>{receipt.consequence}</dd>
            </div>
          </dl>
        </aside>
      )}
      {notice && <p className="status-ok" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {dialog}

      {tab === "profile" && (
        <form className="settings-form panel" onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          void run(async () => { await api.updateMe({ name: String(data.get("name")), email: String(data.get("email")), phone: String(data.get("phone")) }); await refresh(); }, "资料已保存");
        }}>
          <h2>个人资料</h2>
          <label className="field">姓名<input name="name" defaultValue={account?.name || ""} autoComplete="name" required /></label>
          <label className="field">邮箱<input name="email" type="email" defaultValue={account?.email || ""} autoComplete="email" placeholder="sriphy.yan@amperetime.com" /></label>
          <label className="field">手机号<input name="phone" type="tel" defaultValue={account?.phone || ""} autoComplete="tel" inputMode="tel" placeholder="填写后可用手机登录" /></label>
          <p className="muted">身份：{account?.handle || account?.id || "当前账户"}。邮箱和手机只是登录别名，不会改掉账号 handle。</p>
          <button className="btn work">保存资料</button>
        </form>
      )}

      {tab === "starry" && <StarryBindForm onSaved={() => void refresh()} onReceipt={recordReceipt} />}

      {tab === "preferences" && (
        <form className="settings-form panel" onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          const next = {
            theme: data.get("theme"), locale: data.get("locale"), model_tier: data.get("model_tier"),
            default_brand: data.get("default_brand"), default_mailbox: data.get("default_mailbox"),
            notifications: data.get("notifications") === "on", analytics_cookies: data.get("analytics_cookies") === "on",
            left_sidebar_collapsed: localStorage.getItem("ui:left-collapsed") === "true",
            right_workbench_collapsed: localStorage.getItem("ui:right-collapsed") === "true",
          };
          setPreferences(next);
          localStorage.setItem("composer:model-tier", String(next.model_tier));
          localStorage.setItem("ui:left-collapsed", String(next.left_sidebar_collapsed));
          localStorage.setItem("ui:right-collapsed", String(next.right_workbench_collapsed));
          if (next.theme === "system") delete document.documentElement.dataset.theme;
          else document.documentElement.dataset.theme = String(next.theme);
          document.documentElement.lang = String(next.locale || "zh-CN");
          void run(() => api.savePreferences(next), "偏好已保存");
        }}>
          <h2>工作偏好</h2>
          <div className="form-grid">
            <label className="field">主题<select name="theme" defaultValue={String(preferences.theme)}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label>
            <label className="field">语言<select name="locale" defaultValue={String(preferences.locale)}><option value="zh-CN">简体中文</option><option value="en">English</option></select></label>
            <label className="field">模型档位<select name="model_tier" defaultValue={String(preferences.model_tier)}><option value="fast">快速</option><option value="balanced">均衡</option><option value="quality">高质量</option></select></label>
            <label className="field">默认品牌<input name="default_brand" defaultValue={String(preferences.default_brand || "")} /></label>
            <label className="field">默认邮箱<input name="default_mailbox" defaultValue={String(preferences.default_mailbox || "")} /></label>
          </div>
          <label className="check"><input name="notifications" type="checkbox" defaultChecked={Boolean(preferences.notifications)} /> 接收任务与审批通知</label>
          <label className="check"><input name="analytics_cookies" type="checkbox" defaultChecked={Boolean(preferences.analytics_cookies)} /> 允许匿名产品分析 Cookie</label>
          <button className="btn work">保存偏好</button>
        </form>
      )}

      {tab === "security" && <PasswordForm onSave={(body) => run(async () => {
        await api.changePassword(body);
        location.reload();
      }, "密码已更新，请重新登录")} />}

      {tab === "memories" && (
        <section className="panel settings-form">
          <div className="section-head"><div><h2>Markdown 记忆</h2><p className="muted">仅在启用且作用域匹配时用于任务。</p></div><button className="btn" onClick={() => setMemories((m) => [...m, { title: "新记忆", body_md: "", enabled: true, scope: "private", version: 1 }])}>新建</button></div>
          {memories.map((memory, index) => (
            <article className="memory-editor" key={memory.id || `new-${index}`}>
              <input aria-label="记忆标题" value={memory.title || ""} onChange={(e) => setMemories((m) => m.map((x, i) => i === index ? { ...x, title: e.target.value } : x))} />
              <textarea aria-label="Markdown 记忆内容" rows={7} value={memory.body_md || ""} onChange={(e) => setMemories((m) => m.map((x, i) => i === index ? { ...x, body_md: e.target.value } : x))} />
              <div className="actions">
                <label className="check"><input type="checkbox" checked={memory.enabled !== false} onChange={(e) => setMemories((m) => m.map((x, i) => i === index ? { ...x, enabled: e.target.checked } : x))} />启用</label>
                <select aria-label="记忆作用域" value={memory.scope || "private"} onChange={(e) => setMemories((m) => m.map((x, i) => i === index ? { ...x, scope: e.target.value } : x))}><option value="private">仅自己</option><option value="team">团队</option></select>
                <span className="muted">v{memory.version || 1}</span>
                <button className="btn" onClick={() => void run(async () => {
                  const saved = memory.id ? await api.updateMemory(memory.id, memory) : await api.createMemory(memory);
                  setMemories((m) => m.map((x, i) => i === index ? saved as Memory : x));
                }, "记忆已保存")}>保存</button>
                <button
                  className="btn danger"
                  type="button"
                  data-memory-delete={memory.id || `new-${index}`}
                  onClick={() => {
                    const copy = memoryDeleteConfirm(
                      memory.title || "这条记忆",
                      memory.scope === "team" ? "团队" : "仅自己",
                    );
                    ask(copy, async () => {
                      if (memory.id) await api.deleteMemory(memory.id);
                      setMemories((m) => m.filter((_, i) => i !== index));
                      recordReceipt({
                        kind: "memory-delete",
                        object: copy.object,
                        scope: copy.scope,
                        consequence: copy.consequence,
                        text: `已删除记忆「${copy.object}」。`,
                      });
                    });
                  }}
                >删除</button>
              </div>
            </article>
          ))}
        </section>
      )}

      {tab === "privacy" && (
        <section className="panel settings-form">
          <h2>隐私与数据</h2>
          <p>账户数据摘要</p>
          <dl className="summary-list">{Object.entries(summary).map(([key, value]) => <div key={key}><dt>{dataSummaryLabel(key)}</dt><dd>{formatDataSummaryValue(key, value)}</dd></div>)}</dl>
          {!Object.keys(summary).length && <p className="muted">数据摘要 API 暂不可用。</p>}
          <p className="muted">会话分享默认只包含公开对话与产物；内部中文、审批详情和私有记忆不会被包含。</p>
          <h3>Cookie</h3>
          <p className="muted">必要 Cookie：登录与安全（不可关闭）</p>
          <p>匿名分析 Cookie：{preferences.analytics_cookies ? "已允许" : "未允许"}</p>
          <h3>对话存储</h3>
          {!sessions.length && <p className="muted">暂无对话。创建会话后可在这里导出、归档、恢复或删除。</p>}
          {sessions.map((session) => (
            <div className="admin-row" key={session.id}>
              <div><strong>{session.title}</strong><p className="muted">{session.archived_at ? "已归档" : "进行中"}</p></div>
              <div className="actions">
                <a className="btn" href={`/api/sessions/${session.id}/export?format=md`} download>导出 MD</a>
                <a className="btn" href={`/api/sessions/${session.id}/export?format=json`} download>导出 JSON</a>
                <button className="btn" onClick={() => void run(async () => {
                  if (session.archived_at) {
                    await api.unarchiveSession(session.id);
                    setSessions((rows) => rows.map((row) => row.id === session.id ? { ...row, archived_at: null } : row));
                  } else {
                    await api.archiveSession(session.id);
                    setSessions((rows) => rows.map((row) => row.id === session.id ? { ...row, archived_at: new Date().toISOString() } : row));
                  }
                }, session.archived_at ? "会话已恢复" : "会话已归档")}>{session.archived_at ? "恢复" : "归档"}</button>
                <button
                  className="btn danger"
                  type="button"
                  data-session-delete={session.id}
                  onClick={() => {
                    const copy = sessionDeleteConfirm(session.title);
                    ask(copy, async () => {
                      await api.deleteSession(session.id);
                      setSessions((rows) => rows.filter((row) => row.id !== session.id));
                      recordReceipt({
                        kind: "session-delete",
                        object: copy.object,
                        scope: copy.scope,
                        consequence: copy.consequence,
                        text: `已删除会话「${copy.object}」。`,
                      });
                    });
                  }}
                >删除</button>
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function PasswordForm({ onSave }: { onSave: (body: { current_password: string; new_password: string }) => Promise<void> }) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const next = String(data.get("new_password"));
    if (next !== String(data.get("confirm_password"))) return;
    void onSave({ current_password: String(data.get("current_password")), new_password: next });
    event.currentTarget.reset();
  };
  return <form className="settings-form panel" onSubmit={submit}><h2>修改密码</h2><label className="field">当前密码<input name="current_password" type="password" autoComplete="current-password" required /></label><label className="field">新密码<input name="new_password" type="password" minLength={10} autoComplete="new-password" required /></label><label className="field">确认新密码<input name="confirm_password" type="password" minLength={10} autoComplete="new-password" required /></label><button className="btn work">更新密码</button></form>;
}
