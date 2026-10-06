import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { approvalDecideConfirm, approvalInitiateConfirm } from "../adminConfirm";
import { api } from "../api";
import { useAccount } from "../components/AuthGate";
import { useAdminConfirm } from "../components/ConfirmDialog";
import { approvalStatusLabel, friendlyError, stripApprovalRecordIds } from "../labels";
import { randomUuid } from "../uuid";

type PathNode = { name: string; role: string; state?: string; state_label?: string };
type Receipts = {
  decision?: string;
  decision_label?: string;
  gateway?: string;
  gateway_label?: string;
  external?: string;
  external_label?: string;
};

type Approval = {
  id: string;
  kind?: string;
  kind_label?: string;
  action_id?: string;
  title?: string;
  brand: string;
  amount_usd: number;
  status: string;
  business_status?: string;
  business_status_label?: string;
  chain: string[];
  current_index: number;
  wecom_card_id: string;
  need_manual_band: number;
  chain_id?: string;
  can_decide?: boolean;
  allowed_actions?: string[];
  expected_role?: string;
  submitted_by?: string;
  payload?: Record<string, unknown>;
  version?: number;
  version_code?: string;
  object_label?: string;
  consequence_label?: string;
  requester_name?: string;
  waiting_duration_label?: string;
  current_node?: string;
  path?: PathNode[];
  receipts?: Receipts;
  evidence?: {
    object?: string;
    scope?: string;
    change?: string;
    consequence?: string;
    approval_state?: string;
    rule_version?: string;
  };
  chain_detail: { name: string; role: string }[];
  wecom_card?: { status: string; body: string; assignee: string };
};

type Box = "inbox" | "submitted" | "done";
type Decision = "approve" | "reject";

type Preview = {
  steps: { name: string; role: string }[];
  expected_version?: number;
  plan?: { rule_id?: string; amount_base?: number; currency?: string; amount?: number; requester_name?: string };
};

type PendingConfirm = {
  id: string;
  decision: Decision;
};

type SessionReceipt = {
  id: string;
  decision?: Decision | "submit";
  text: string;
  tone: "ok" | "danger" | "info";
};

type WecomCard = {
  approval_id: string;
  body: string;
  status: string;
  assignee: string;
};

const CURRENCIES = [
  ["CNY", "人民币"],
  ["USD", "美元"],
  ["EUR", "欧元"],
  ["GBP", "英镑"],
  ["JPY", "日元"],
  ["AUD", "澳元"],
  ["CAD", "加元"],
  ["HKD", "港币"],
] as const;

const BOXES: { id: Box; label: string }[] = [
  { id: "inbox", label: "待我处理" },
  { id: "submitted", label: "我发起的" },
  { id: "done", label: "已处理" },
];

function parseBox(raw: string | null): Box {
  if (raw === "submitted" || raw === "done") return raw;
  return "inbox";
}

function newIdempotencyKey() {
  return randomUuid();
}

function isStaleError(error: unknown): boolean {
  const payload = error && typeof error === "object" ? (error as { payload?: { detail?: { code?: string } } }).payload : undefined;
  const code = payload?.detail?.code;
  if (code === "stale") return true;
  return /内容已变化|stale/i.test(error instanceof Error ? error.message : String(error || ""));
}

function kindLabel(row: Approval) {
  return row.kind_label || ({
    expense: "费用审批",
    stage: "阶段审批",
    content: "内容审核",
    settlement: "结算审批",
  }[row.kind || row.action_id || "expense"] || "审批");
}

function formatAmount(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? "");
  return n.toLocaleString("zh-CN");
}

function moneyLine(row: Approval) {
  if (row.object_label) return row.object_label;
  if (row.kind && row.kind !== "expense") {
    return row.title || String(row.payload?.reason || "确认阶段");
  }
  const payload = row.payload || {};
  const currency = String(payload.currency || "CNY");
  const amount = payload.amount;
  const base = payload.amount_base ?? row.amount_usd;
  const requester = payload.requester_name ? `${payload.requester_name}申请` : "费用申请";
  if (currency !== "CNY" && amount != null && amount !== "") {
    return `${requester} ${currency} ${formatAmount(amount)}，折合人民币 ${formatAmount(base)}`;
  }
  return `${requester} 人民币 ${formatAmount(base)}`;
}

function pathNodes(row: Approval): PathNode[] {
  if (row.path?.length) return row.path;
  return (row.chain_detail || []).map((step, index) => {
    let state = "todo";
    if (row.status === "consumed" || row.status === "sent") state = "done";
    else if (row.status === "rejected") {
      if (index < row.current_index) state = "done";
      else if (index === row.current_index) state = "rejected";
    } else if (index < row.current_index) state = "done";
    else if (index === row.current_index) state = "current";
    const labels = { done: "已通过", current: "当前", rejected: "已驳回", todo: "待处理" };
    return { ...step, state, state_label: labels[state as keyof typeof labels] };
  });
}

function waitingName(row: Approval) {
  return row.current_node || row.chain_detail?.[row.current_index]?.name || "下一位审批人";
}

function isFinalStep(row: Approval) {
  return row.current_index >= (row.chain_detail?.length || row.chain.length) - 1;
}

function rejectReasonOf(row: Approval): string {
  return String(row.payload?.reject_reason || "").trim();
}

function statusCopy(row: Approval) {
  if (row.status === "consumed" || row.status === "sent" || row.status === "approved") return "审批已通过";
  return approvalStatusLabel(row.status);
}

function durableReceipt(row: Approval, session?: SessionReceipt | null): { text: string; tone: "ok" | "danger" | "info" } | null {
  if (session && session.id === row.id) return { text: session.text, tone: session.tone };
  const notice = stripApprovalRecordIds(row.wecom_card?.body);
  const reason = rejectReasonOf(row);
  if (row.status === "rejected") {
    return {
      text: reason ? `已驳回，本单已作废。原因：${reason}` : notice || "已驳回，本单已作废。",
      tone: "danger",
    };
  }
  if (row.status === "consumed" || row.status === "sent") {
    return { text: "审批已通过，请查看业务结果。", tone: "ok" };
  }
  if (row.status === "pending" && row.current_index > 0 && notice) {
    return { text: notice, tone: "ok" };
  }
  return null;
}

function consequenceCopy(row: Approval, decision: Decision): string {
  if (decision === "reject") return "驳回后整单作废，不能再同意。";
  if (isFinalStep(row)) {
    return row.kind && row.kind !== "expense"
      ? "你是最后一位。同意后本单办结，并写入已确认的阶段。"
      : "你是最后一位。同意后审批通过，外部执行结果另行核对。";
  }
  const next = row.chain_detail?.[row.current_index + 1]?.name || "下一位审批人";
  return `同意后，审批交给下一位「${next}」。本单不会办结。`;
}

function receiptCopy(row: Approval, decision: Decision, result: Record<string, unknown>, reason: string): SessionReceipt {
  if (decision === "reject") {
    return { id: row.id, decision, tone: "danger", text: `已驳回，本单已作废。原因：${reason}` };
  }
  if (result.status === "consumed" || result.status === "sent") {
    return { id: row.id, decision, tone: "ok", text: "审批已通过，请查看业务结果。" };
  }
  const next = (result.chain_detail as { name: string }[] | undefined)?.[Number(result.current_index)]?.name
    || row.chain_detail?.[row.current_index + 1]?.name
    || "下一位审批人";
  return { id: row.id, decision, tone: "ok", text: `已同意。下一任：${next}。` };
}

function ReceiptLines({ row }: { row: Approval }) {
  const receipts = row.receipts;
  if (!receipts || receipts.decision === "none" || !receipts.decision) return null;
  return (
    <ul className="approval-receipt-lines" data-approval-receipt-lines>
      <li data-receipt="decision">审批结果：{statusCopy(row)}</li>
      <li data-receipt="gateway"><details><summary>执行记录</summary>{receipts.gateway_label || "尚未提交业务执行"}</details></li>
      <li data-receipt="external" data-receipt-state={receipts.external || "pending_check"}>
        业务结果 · 外部回执：{receipts.external_label || "待核对"}
      </li>
    </ul>
  );
}

function InitiateExpenseForm({
  onCreated,
  ask,
  locked,
}: {
  locked: boolean;
  onCreated: (id: string) => void;
  ask: ReturnType<typeof useAdminConfirm>["ask"];
}) {
  const { account } = useAccount();
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("CNY");
  const [requester, setRequester] = useState("");
  const [purpose, setPurpose] = useState("");
  const [brand, setBrand] = useState("");
  const [region, setRegion] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState("");
  useEffect(() => setPreview(null), [amount, currency, requester, purpose, brand, region]);

  const payload = () => ({
    kind: "expense" as const,
    amount: Number(amount),
    currency,
    ...(requester.trim() ? { requester_name: requester.trim() } : {}),
    ...(purpose.trim() ? { purpose: purpose.trim() } : {}),
    ...(brand ? { brand } : {}),
    ...(region ? { region } : {}),
  });

  const runPreview = async () => {
    if (!amount || Number(amount) <= 0) {
      setPreview(null);
      return null;
    }
    try {
      const result = await api.previewApproval(payload());
      setPreview(result);
      setFormErr("");
      return result;
    } catch (e) {
      setPreview(null);
      setFormErr(friendlyError(e, "还无法计算审批路径"));
      return null;
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFormErr("");
    if (!amount || Number(amount) <= 0) {
      setFormErr("请填写金额");
      return;
    }
    if (busy) return;
    setBusy(true);
    const ready = await runPreview();
    setBusy(false);
    if (!ready || ready.expected_version == null) return;
    const object = `${ready.plan?.requester_name || requester.trim() || account?.name || "当前登录人"}申请 ${currency} ${formatAmount(Number(amount))}`;
    const rule = ready.plan?.rule_id || "";
    ask(
      approvalInitiateConfirm({
        object,
        scope: "按费用规则发起 · 不会改合作阶段",
        change: ready.steps.map((step) => step.name).join(" → ") || "按规则计算审批链",
        consequence: "确认后生成待决定单据。现在不会批准，也不会产生外部回执。",
        approvalState: "待提交",
        ruleVersion: rule,
      }),
      async () => {
        const created = await api.createApproval({
          ...payload(),
          expected_version: ready.expected_version,
          idempotency_key: newIdempotencyKey(),
        });
        setAmount("");
        setPurpose("");
        setPreview(null);
        onCreated(String(created.id));
      },
    );
  };

  return (
    <form className="panel approval-initiate" data-approval-initiate onSubmit={(event) => void submit(event)}>
      <h2>发起费用审批</h2>
      <p className="muted">填写金额和币种后，系统按规则算出审批人。阶段变更请在合作确认里提交，不要写在这里。</p>
      <div className="approval-initiate-grid">
        <label className="field">
          金额
          <input
            name="amount"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            onBlur={() => void runPreview()}
            placeholder="例如 5000"
            required
          />
        </label>
        <label className="field">
          币种
          <select
            name="currency"
            value={currency}
            onChange={(event) => setCurrency(event.target.value)}
            onBlur={() => void runPreview()}
          >
            {CURRENCIES.map(([code, label]) => (
              <option key={code} value={code}>{label}</option>
            ))}
          </select>
        </label>
        <label className="field">
          申请人
          <input
            name="requester"
            value={account?.name || "当前登录人"}
            readOnly
            onBlur={() => void runPreview()}
            placeholder={account?.name ? `默认 ${account.name}` : "默认当前登录人"}
            autoComplete="name"
          />
        </label>
        <label className="field">
          用途
          <input
            name="purpose"
            value={purpose}
            onChange={(event) => setPurpose(event.target.value)}
            placeholder="可选"
          />
        </label>
        <label className="field">
          品牌
          <select
            name="brand"
            value={brand}
            onChange={(event) => setBrand(event.target.value)}
            onBlur={() => void runPreview()}
          >
            <option value="">全部品牌</option>
            <option value="LT">LiTime</option>
            <option value="PQ">Power Queen</option>
            <option value="RO">Redodo</option>
          </select>
        </label>
        <label className="field">
          区域
          <select
            name="region"
            value={region}
            onChange={(event) => setRegion(event.target.value)}
            onBlur={() => void runPreview()}
          >
            <option value="">全部区域</option>
            <option value="北美">北美</option>
            <option value="欧洲">欧洲</option>
            <option value="日本">日本</option>
            <option value="澳洲">澳洲</option>
            <option value="国内">国内</option>
          </select>
        </label>
      </div>
      {preview && preview.steps.length > 0 && (
        <div data-approval-preview>
          <p className="muted">将按费用规则提交。审批链如下，确认后提交。</p>
          <ol className="approval-path">
            {preview.steps.map((step, index) => (
              <li key={`${step.name}-${index}`} data-path-state={index === 0 ? "current" : "todo"}>
                <span>{step.name}</span>
                <small>{step.role}</small>
                <span className="path-state">{index === 0 ? "当前" : "待处理"}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
      {formErr && <p className="error" role="alert">{formErr}</p>}
      <button className={locked || busy ? "btn" : "btn primary"} type="submit" disabled={busy || locked}>
        {busy ? "提交中…" : "提交费用审批"}
      </button>
    </form>
  );
}

export type ApprovalRow = Approval;

export function approvalSubject(row: Approval): string {
  return moneyLine(row);
}

export default function Approvals({
  embedded = false,
  onExplainRisk,
}: {
  embedded?: boolean;
  onExplainRisk?: (row: Approval) => void;
} = {}) {
  const params = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const box = parseBox(searchParams.get("box"));
  const focusId = params.id || searchParams.get("id") || "";
  const [rows, setRows] = useState<Approval[]>([]);
  const [focused, setFocused] = useState<Approval | null>(null);
  const [cards, setCards] = useState<WecomCard[]>([]);
  const [err, setErr] = useState("");
  const [expandedId, setExpandedId] = useState("");
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const [receipts, setReceipts] = useState<Record<string, SessionReceipt>>({});
  const [reloadTick, setReloadTick] = useState(0);
  const [creating, setCreating] = useState(false);
  const { ask, dialog, open: confirmOpen } = useAdminConfirm();

  const setQuery = (next: { box?: Box; id?: string }) => {
    const paramsNext = new URLSearchParams();
    paramsNext.set("box", next.box || box);
    const id = next.id === undefined ? focusId : next.id;
    if (id) paramsNext.set("id", id);
    setSearchParams(paramsNext);
  };

  const load = () => {
    setErr("");
    api.approvals(box)
      .then((r) => setRows(Array.isArray(r) ? r as Approval[] : []))
      .catch((error) => {
        setRows([]);
        setErr(friendlyError(error, "无法加载审批，请稍后重试"));
      });
    api.wecomCards()
      .then((r) => setCards(Array.isArray(r) ? r as WecomCard[] : []))
      .catch(() => setCards([]));
  };
  useEffect(load, [box, reloadTick]);

  useEffect(() => {
    if (!focusId) {
      setFocused(null);
      return;
    }
    const local = rows.find((row) => row.id === focusId);
    if (local) {
      setFocused(local);
      return;
    }
    api.approval(focusId)
      .then((row) => setFocused(row as Approval))
      .catch(() => setFocused(null));
  }, [focusId, rows]);

  const decide = (row: Approval, decision: Decision) => {
    setErr("");
    if (row.version == null) {
      setErr("缺少版本，无法确认。请刷新后重试。");
      return;
    }
    setPending({ id: row.id, decision });
    const evidence = row.evidence || {};
    ask(
      approvalDecideConfirm({
        decision,
        object: evidence.object || moneyLine(row),
        scope: [
          evidence.scope || (row.kind && row.kind !== "expense" ? "按审批规则" : "按费用规则"),
          `当前等待 ${waitingName(row)}（第 ${row.current_index + 1}/${row.chain_detail?.length || row.chain.length} 人）`,
        ].join(" · "),
        change: evidence.change || row.consequence_label || moneyLine(row),
        consequence: consequenceCopy(row, decision),
        approvalState: evidence.approval_state || statusCopy(row),
        ruleVersion: evidence.rule_version || row.version_code || "",
      }),
      async (reason) => {
        try {
          const result = await api.decide(
            row.id,
            decision,
            undefined,
            decision === "reject" ? reason : undefined,
            { expected_version: Number(row.version || 0), idempotency_key: newIdempotencyKey() },
          );
          const receipt = receiptCopy(row, decision, result, reason);
          setReceipts((prev) => ({ ...prev, [row.id]: receipt }));
          setQuery({ id: row.id, box: decision === "reject" || result.status === "consumed" ? "done" : box });
          setPending(null);
          setExpandedId("");
          load();
        } catch (e) {
          if (isStaleError(e)) {
            setExpandedId("");
            setPending(null);
            load();
            throw new Error("内容已变化，请重新确认。");
          }
          throw new Error(friendlyError(e, "审批未完成，请稍后重试"));
        }
      },
    );
  };

  useEffect(() => {
    if (confirmOpen) return;
    setPending(null);
  }, [confirmOpen]);

  const transfer = (row: Approval) => {
    setErr("");
    if (row.version == null) {
      setErr("缺少版本，无法转交。请刷新后重试。");
      return;
    }
    const target = window.prompt("转交给谁？请输入员工姓名或工号：", "");
    if (!target || !target.trim()) return;
    ask(
      approvalDecideConfirm({
        decision: "approve",
        object: `转交：${moneyLine(row)}`,
        scope: `当前等待 ${waitingName(row)}`,
        change: `转给 ${target.trim()}`,
        consequence: "转交后由目标审批人继续处理，你不再是当前节点。",
        approvalState: statusCopy(row),
        ruleVersion: row.version_code || "",
      }),
      async () => {
        try {
          await api.transferApproval(
            row.id,
            target.trim(),
            undefined,
            { expected_version: Number(row.version || 0), idempotency_key: newIdempotencyKey() },
          );
          setExpandedId("");
          load();
        } catch (e) {
          throw new Error(friendlyError(e, "转交未完成，请稍后重试"));
        }
      },
    );
  };

  const withdraw = (row: Approval) => {
    setErr("");
    if (row.version == null) {
      setErr("缺少版本，无法撤回。请刷新后重试。");
      return;
    }
    ask(
      approvalDecideConfirm({
        decision: "reject",
        object: `撤回：${moneyLine(row)}`,
        scope: "我发起的",
        change: "撤回后单据作废，审批链停止流转",
        consequence: "撤回后如需继续，需重新发起。",
        approvalState: statusCopy(row),
        ruleVersion: row.version_code || "",
      }),
      async () => {
        try {
          await api.withdrawApproval(row.id, {
            expected_version: Number(row.version || 0),
            idempotency_key: newIdempotencyKey(),
          });
          setExpandedId("");
          setQuery({ box: "submitted" });
          load();
        } catch (e) {
          throw new Error(friendlyError(e, "撤回未完成，请稍后重试"));
        }
      },
    );
  };

  const countersign = (row: Approval) => {
    setErr("");
    if (row.version == null) {
      setErr("缺少版本，无法加签。请刷新后重试。");
      return;
    }
    const target = window.prompt("加签给谁？请输入员工姓名或工号（加签人仅查看，不继承你的审批权限）：", "");
    if (!target || !target.trim()) return;
    ask(
      approvalDecideConfirm({
        decision: "approve",
        object: `加签：${moneyLine(row)}`,
        scope: `当前等待 ${waitingName(row)}`,
        change: `在当前节点后加签 ${target.trim()}`,
        consequence: "加签后单据先经加签人确认，再继续原流程。",
        approvalState: statusCopy(row),
        ruleVersion: row.version_code || "",
      }),
      async () => {
        try {
          await api.countersignApproval(
            row.id,
            target.trim(),
            undefined,
            { expected_version: Number(row.version || 0), idempotency_key: newIdempotencyKey() },
          );
          setExpandedId("");
          load();
        } catch (e) {
          throw new Error(friendlyError(e, "加签未完成，请稍后重试"));
        }
      },
    );
  };

  useEffect(() => {
    if (focusId) setExpandedId(focusId);
  }, [focusId]);

  const visible = useMemo(() => {
    const extra = focused && !rows.some((row) => row.id === focused.id) ? [focused] : [];
    return [...extra, ...rows];
  }, [rows, focused]);

  useEffect(() => {
    if (!focusId) return;
    const node = document.querySelector(`[data-approval-id="${CSS.escape(focusId)}"]`);
    node?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusId, visible]);

  return (
    <div className={"list-page approval-page" + (embedded ? " is-embedded" : "")} data-approval-queue={embedded ? "embedded" : "page"}>
      {dialog}
      {!embedded ? (
        <>
          <header className="approval-page-head">
            <h1>旧审批单据</h1>
            <Link to="/approvals">审批中心</Link>
            <button className={!creating && !expandedId && !confirmOpen ? "btn primary" : "btn"} onClick={() => setCreating(!creating)}>{creating ? "返回列表（保留填写）" : "发起费用审批"}</button>
          </header>
          <div hidden={!creating}>
          <InitiateExpenseForm
            locked={confirmOpen}
            ask={ask}
            onCreated={(id) => {
              setErr("");
              setCreating(false);
              setReceipts((prev) => ({ ...prev, [id]: { id, decision: "submit", tone: "info", text: "已提交" } }));
              setQuery({ box: "submitted", id });
              setReloadTick((value) => value + 1);
            }}
          />
          </div>
        </>
      ) : (
        <p className="muted" data-approval-workbench-hint>
          同意或驳回必须由你点下。需要分析风险时，走合作专员思考页，分析页不会出现批准按钮。
          发起费用审批请到 <Link to="/approvals">工作审批</Link>。
        </p>
      )}
      <div hidden={creating}>
      <div className="task-filters approval-filters" aria-label="筛选审批">
        {BOXES.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={box === item.id}
            onClick={() => setQuery({ box: item.id, id: focusId })}
            data-approval-box={item.id}
            data-approval-slice={item.id}
          >
            {item.label}
          </button>
        ))}
      </div>
      {err && <p className="error" role="alert">{err}</p>}
      {visible.length === 0 && <p className="muted">这个筛选下暂无审批。</p>}
      {visible.map((a) => {
        const current = waitingName(a);
        const notice = stripApprovalRecordIds(a.wecom_card?.body);
        const receipt = durableReceipt(a, receipts[a.id]);
        const confirming = confirmOpen && pending?.id === a.id;
        const inbox = box === "inbox" && a.can_decide !== false && a.status === "pending";
        const expanded = expandedId === a.id;
        const nodes = pathNodes(a);
        return (
          <article
            className={"panel approval-card" + (a.status === "pending" ? " is-pending" : "") + (focusId === a.id ? " is-focus" : "")}
            key={a.id}
            data-approval-id={a.id}
            data-approval-kind={a.kind || a.action_id || "expense"}
            data-approval-status={a.status}
            data-approval-focus={focusId === a.id ? "true" : undefined}
            data-approval-version={a.version ?? ""}
          >
            <button className="approval-summary" aria-expanded={expanded} onClick={() => setExpandedId(expanded ? "" : a.id)}><span>{moneyLine(a)}</span><span>{kindLabel(a)}</span><span>{statusCopy(a)}</span></button>
            {expanded && <div className="approval-detail-body">
            <p className="muted">
              {a.kind && a.kind !== "expense" ? "按审批规则" : "按费用规则"}
              {a.need_manual_band ? " · 需人工确认金额档" : ""}
              {a.requester_name ? ` · 申请人 ${a.requester_name}` : ""}
              {a.waiting_duration_label ? ` · ${a.waiting_duration_label}` : ""}
              {a.status === "pending" ? ` · 当前等待 ${current}（第 ${a.current_index + 1}/${a.chain_detail?.length || a.chain.length} 人）` : ""}
            </p>
            <p className="approval-row-meta" data-approval-row-meta>

              {a.consequence_label ? <span data-approval-consequence> · {a.consequence_label}</span> : null}
              {a.version_code ? <span data-approval-version-code> · {a.version_code}</span> : null}
            </p>
            <ol className="approval-path" data-approval-path>
              {nodes.map((step, index) => (
                <li key={`${step.name}-${index}`} data-path-state={step.state || "todo"}>
                  <span>{step.name}</span>
                  <small>{step.role}</small>
                  <span className="path-state">{step.state_label || ""}</span>
                </li>
              ))}
            </ol>
            {notice && !receipt && <p className="muted" data-approval-notice>{notice}</p>}
            {receipt && (
              <p className="approval-receipt" data-approval-receipt data-tone={receipt.tone} role="status">
                {receipt.text}
              </p>
            )}
            <ReceiptLines row={a} />
            </div>}
            {inbox && !expanded && !confirming && (
              <div className="approval-actions">
                <button
                  type="button"
                  className={focusId === a.id ? "btn primary" : "btn"}
                  data-approval-decide
                  onClick={() => {
                    setExpandedId(a.id);
                    setQuery({ id: a.id, box: "inbox" });
                  }}
                >
                  决定
                </button>
              </div>
            )}
            {inbox && expanded && !confirming && (
              <div className="approval-actions" data-approval-detail>
                <button type="button" className="btn primary" disabled={a.allowed_actions ? !a.allowed_actions.includes("approve") : a.can_decide === false} onClick={() => decide(a, "approve")}>同意</button>
                <button type="button" className="btn danger" disabled={a.allowed_actions ? !a.allowed_actions.includes("reject") : a.can_decide === false} onClick={() => decide(a, "reject")}>驳回</button>
                {a.allowed_actions?.includes("transfer") && <button type="button" className="btn" data-approval-transfer onClick={() => transfer(a)}>转交</button>}
                {a.allowed_actions?.includes("countersign") && <button type="button" className="btn" data-approval-countersign onClick={() => countersign(a)}>加签</button>}
                {onExplainRisk ? (
                  <button
                    type="button"
                    className="btn ghost"
                    data-approval-explain={a.id}
                    onClick={() => onExplainRisk(a)}
                  >
                    说明风险
                  </button>
                ) : null}
              </div>
            )}
            {a.status === "pending" && a.can_decide === false && onExplainRisk ? (
              <div className="approval-actions">
                <button
                  type="button"
                  className="btn ghost"
                  data-approval-explain={a.id}
                  onClick={() => onExplainRisk(a)}
                >
                  说明风险
                </button>
              </div>
            ) : null}
            {a.status === "pending" && a.can_decide === false && (
              <p className="muted">当前等待 {current}。你可以查看进度，但这一步不由你确认。</p>
            )}
            {box === "submitted" && a.status === "pending" && expanded && (
              <div className="approval-actions">
                <button type="button" className="btn" data-approval-withdraw onClick={() => withdraw(a)}>撤回</button>
              </div>
            )}
          </article>
        );
      })}
      <details className="approval-notices"><summary>审批通知 · {cards.length}</summary>
        {cards.length === 0 && <p className="muted">暂无通知。</p>}
        {cards.map((c) => (
          <p key={c.approval_id} className="muted">
            [{approvalStatusLabel(c.status)}] {c.assignee} · {stripApprovalRecordIds(c.body)}
          </p>
        ))}
      </details>
      </div>
    </div>
  );
}
