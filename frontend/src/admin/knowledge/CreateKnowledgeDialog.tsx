import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import type { KnowledgeBaseRow } from "../../api";
import ScopeTabs, { type ScopeOption } from "../../components/ScopeTabs";
import StageTags from "../../components/StageTags";
import { KB_BRANDS, KNOWLEDGE_KIND_SPECS, errorMessage, kindAllowedInBase } from "./shared";
import { brandLabel, kindLabel } from "../../knowledgeCopy";
import KbvIcon from "../../knowledgeIcons";

type Props = {
  open: boolean;
  onClose: () => void;
  bases: KnowledgeBaseRow[];
  onCreated: (id: string, title: string) => void;
};

/**
 * 新建知识弹窗：标题 / 类型 / 分类（族→域→库）/ 适用品牌 / 适用阶段 / 正文。
 * 只写草稿（L2）；发布仍走审批系统，本弹窗不提供发布。
 */
export default function CreateKnowledgeDialog({ open, onClose, bases, onCreated }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState(KNOWLEDGE_KIND_SPECS[0]?.code || "policy");
  const [familyId, setFamilyId] = useState("");
  const [domainId, setDomainId] = useState("");
  const [baseId, setBaseId] = useState("");
  const [brand, setBrand] = useState("*");
  const [stages, setStages] = useState<string[]>([]);
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      setTitle("");
      setKind(KNOWLEDGE_KIND_SPECS[0]?.code || "policy");
      setFamilyId("");
      setDomainId("");
      setBaseId("");
      setBrand("*");
      setStages([]);
      setBody("");
      setError("");
      setSubmitting(false);
      el.showModal();
    }
    if (!open && el.open) el.close();
  }, [open]);

  const familyOptions = useMemo<ScopeOption[]>(() => {
    const seen = new Map<string, string>();
    for (const base of bases) {
      const id = String(base.family_id || "");
      if (!id || seen.has(id)) continue;
      seen.set(id, String(base.family_name || id));
    }
    return [...seen].map(([id, name]) => ({ id, name }));
  }, [bases]);

  const domainOptions = useMemo<ScopeOption[]>(() => {
    const seen = new Map<string, string>();
    for (const base of bases) {
      if (familyId && String(base.family_id || "") !== familyId) continue;
      const id = String(base.domain_id || "");
      if (!id || seen.has(id)) continue;
      seen.set(id, String(base.domain_name || id));
    }
    return [...seen].map(([id, name]) => ({ id, name }));
  }, [bases, familyId]);

  const baseOptions = useMemo<ScopeOption[]>(
    () => bases
      .filter((base) => (domainId
        ? base.domain_id === domainId
        : !familyId || String(base.family_id || "") === familyId))
      .map((base) => ({ id: base.id, name: base.name })),
    [bases, familyId, domainId],
  );

  /** 未选具体库时落「默认结构化库」：code=legacy 优先，其次任一启用中的结构化库（与后端同口径）。 */
  const defaultBase = useMemo(() => {
    const structured = bases.filter((base) => base.kind === "structured" && String(base.status || "active") === "active");
    return structured.find((base) => base.code === "legacy") || structured[0] || null;
  }, [bases]);

  const chosenBase = useMemo(() => bases.find((base) => base.id === baseId) || null, [bases, baseId]);
  const targetBase = chosenBase || defaultBase;
  const kindOk = kindAllowedInBase(kind, targetBase?.kind);
  const canSubmit = Boolean(title.trim()) && Boolean(targetBase) && kindOk && !submitting;

  const submit = async () => {
    if (!canSubmit || !targetBase) return;
    setSubmitting(true);
    setError("");
    try {
      const created = await api.createKnowledge({
        title: title.trim(),
        kind,
        base_id: targetBase.id,
        brand,
        stage_codes: stages,
        body,
      });
      onClose();
      onCreated(created.id, title.trim());
    } catch (cause) {
      setError(errorMessage(cause, "创建草稿失败"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <dialog
      ref={ref}
      className="kbv-dialog"
      data-size="md"
      data-kbv-create-dialog
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="kbv-dialog-head">
        <h2>新建知识</h2>
        <button type="button" className="btn ghost" aria-label="关闭" onClick={onClose}>
          <KbvIcon name="close" />
        </button>
      </div>
      <div className="kbv-dialog-body">
        <p className="muted">填写标题与分类信息，创建后进入草稿，可继续整理正文。</p>

        <label className="kbv-field">
          <span>标题</span>
          <input
            type="text"
            data-kbv-create-title
            placeholder="知识标题"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>

        <div className="kbv-scope-row">
          <span className="kbv-scope-name">类型</span>
          <div className="kbv-scope-tabs" role="group" aria-label="类型">
            {KNOWLEDGE_KIND_SPECS.map((spec) => (
              <button
                key={spec.code}
                type="button"
                className="kbv-tab"
                aria-pressed={kind === spec.code}
                data-kb-create-kind={spec.code}
                onClick={() => setKind(spec.code)}
              >
                {kindLabel(spec.code)}
              </button>
            ))}
          </div>
        </div>

        <div data-kb-create-scope>
          <ScopeTabs
            showCount={false}
            familyOptions={familyOptions}
            domainOptions={domainOptions}
            baseOptions={baseOptions}
            familyId={familyId}
            domainId={domainId}
            baseId={baseId}
            onFamily={(id) => {
              setFamilyId(id);
              setDomainId("");
              setBaseId("");
            }}
            onDomain={(id) => {
              setDomainId(id);
              setBaseId("");
            }}
            onBase={setBaseId}
            familyTotal={0}
            domainTotal={0}
            baseTotal={0}
          />
        </div>

        <div className="kbv-scope-row">
          <span className="kbv-scope-name">适用品牌</span>
          <div className="kbv-scope-tabs" role="group" aria-label="适用品牌">
            <button
              type="button"
              className="kbv-tab"
              aria-pressed={brand === "*"}
              data-kb-create-brand="*"
              onClick={() => setBrand("*")}
            >
              全品牌
            </button>
            {KB_BRANDS.map((code) => (
              <button
                key={code}
                type="button"
                className="kbv-tab"
                aria-pressed={brand === code}
                data-kb-create-brand={code}
                onClick={() => setBrand(code)}
              >
                {brandLabel(code)}
              </button>
            ))}
          </div>
        </div>

        <StageTags selected={stages} onChange={setStages} />

        <label className="kbv-field">
          <span>正文</span>
          <textarea
            data-kbv-create-body
            placeholder="知识正文…"
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
        </label>

        {!targetBase ? (
          <p className="kbv-error" role="alert">还没有可写入的结构化知识库；先到知识目录建一个。</p>
        ) : null}
        {targetBase && !kindOk ? (
          <p className="kbv-error" role="alert">所选知识库类型与「{kindLabel(kind)}」不兼容，换一个知识库。</p>
        ) : null}
        {error ? <p className="kbv-error" role="alert">{error}</p> : null}
      </div>
      <div className="kbv-dialog-actions">
        <Link className="kbv-link-plain" to="/admin/knowledge/catalog" onClick={onClose}>去知识目录</Link>
        <button type="button" className="btn" onClick={onClose}>取消</button>
        <button type="button" className="btn work" data-kbv-create-submit disabled={!canSubmit} onClick={submit}>
          创建草稿
        </button>
      </div>
    </dialog>
  );
}
