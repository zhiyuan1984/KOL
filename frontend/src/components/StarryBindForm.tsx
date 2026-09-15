import { useEffect, useState } from "react";
import { api } from "../api";
import type { StarryBinding } from "../api";
import { starryUnbindConfirm } from "../adminConfirm";
import { useAdminConfirm } from "./ConfirmDialog";
import type { SettingsReceipt } from "../settingsReceipt";

export default function StarryBindForm({
  onSaved,
  onReceipt,
}: {
  onSaved: () => void;
  onReceipt?: (receipt: Omit<SettingsReceipt, "at">) => void;
}) {
  const [binding, setBinding] = useState<StarryBinding>({ bound: false, status: "unbound" });
  const [mailboxes, setMailboxes] = useState<Array<{ id: string; mailbox_email: string; owner_name: string; brand: string }>>([]);
  const [chosen, setChosen] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const { ask, dialog } = useAdminConfirm();

  const load = () => api.starryBinding().then(setBinding).catch(() => undefined);

  useEffect(() => {
    void load();
  }, []);

  const bearerFrom = (form: HTMLFormElement) => String(new FormData(form).get("bearer") || "").trim();

  const probe = async (form: HTMLFormElement) => {
    const bearer = bearerFrom(form);
    setBusy("probe");
    setError("");
    setNotice("");
    try {
      const result = await api.probeStarryBinding(bearer ? { bearer } : {});
      setMailboxes(result.mailboxes || []);
      const unique = result.mailboxes.length === 1 ? result.mailboxes[0] : undefined;
      setChosen(unique?.mailbox_email || "");
      setNotice(result.mailboxes.length ? `找到 ${result.mailboxes.length} 个可用发件箱` : "没有可用发件箱");
    } catch (e) {
      setError(e instanceof Error ? e.message : "无法读取邮箱列表");
    } finally {
      setBusy("");
    }
  };

  const save = async (form: HTMLFormElement) => {
    const bearer = bearerFrom(form);
    if (!chosen) {
      setError("请选择要绑定的发件邮箱");
      return;
    }
    setBusy("save");
    setError("");
    try {
      const picked = mailboxes.find((row) => row.mailbox_email === chosen);
      const saved = await api.saveStarryBinding({
        mailbox_email: chosen,
        mailbox_id: picked?.id,
        owner_name: picked?.owner_name,
        bearer: bearer || undefined,
      });
      setBinding(saved);
      setNotice(`已连接 ${saved.mailbox_email}${saved.owner_name ? ` · ${saved.owner_name}` : ""}`);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "绑定失败");
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="panel settings-form" data-starry-bind>
      <h2>连接 Starry KOL</h2>
      <p className="muted">把当前灵工账号绑到一个 Starry 发件箱。首页「我跟进的红人」只显示该邮箱负责人跟进的红人。JWT 不会回显。</p>
      {binding.bound ? (
        <p className="status-ok" data-starry-status="connected">
          已连接 · {binding.mailbox_email}
          {binding.owner_name ? ` · ${binding.owner_name}` : ""}
          {binding.status === "expired" ? " · 已过期" : ""}
        </p>
      ) : (
        <p className="muted" data-starry-status="unbound">尚未绑定跟进邮箱。</p>
      )}
      {notice && <p className="status-ok" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void (mailboxes.length ? save(event.currentTarget) : probe(event.currentTarget));
        }}
      >
        <label className="field">
          Starry 用户 JWT（可选）
          <textarea name="bearer" rows={3} autoComplete="off" spellCheck={false} placeholder="已配置 Host Bearer 时可留空；过期时再粘贴新的 JWT" />
        </label>
        <div className="actions">
          <button
            className="btn"
            type="button"
            data-starry-probe
            disabled={Boolean(busy)}
            onClick={(event) => {
              const form = event.currentTarget.form;
              if (form) void probe(form);
            }}
          >
            {busy === "probe" ? "读取中…" : "读取可用邮箱"}
          </button>
        </div>
        {mailboxes.length ? (
          <fieldset className="mailbox-pick">
            <legend>选择跟进邮箱</legend>
            {mailboxes.map((box) => (
              <label key={box.mailbox_email} className="check">
                <input
                  type="radio"
                  name="mailbox_email"
                  value={box.mailbox_email}
                  checked={chosen === box.mailbox_email}
                  onChange={() => setChosen(box.mailbox_email)}
                />
                {box.mailbox_email}
                {box.owner_name ? ` · ${box.owner_name}` : ""}
                {box.brand ? ` · ${box.brand}` : ""}
              </label>
            ))}
          </fieldset>
        ) : null}
        {mailboxes.length ? <button className="btn work" data-starry-save disabled={busy === "save"}>{busy === "save" ? "保存中…" : "绑定所选邮箱"}</button> : null}
      </form>
      {binding.bound && (
        <button
          className="btn danger"
          type="button"
          data-starry-unbind
          onClick={() => {
            const copy = starryUnbindConfirm(binding.mailbox_email || "", binding.owner_name || "");
            ask(copy, async () => {
              const next = await api.clearStarryBinding();
              setBinding(next);
              setMailboxes([]);
              setNotice("已解除绑定");
              onReceipt?.({
                kind: "starry-unbind",
                object: copy.object,
                scope: copy.scope,
                consequence: copy.consequence,
                text: `已解除跟进邮箱绑定「${copy.object}」。`,
              });
              onSaved();
            });
          }}
        >
          解除绑定
        </button>
      )}
      {dialog}
    </section>
  );
}
