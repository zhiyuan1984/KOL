import WorkspaceActions from "./WorkspaceActions";
import { reviewCompany } from '../../reviews/api';
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type KnowledgeBaseRow } from "../../api";
import ScopeTabs, { type ScopeOption } from "../../components/ScopeTabs";
import KbvIcon from "../../knowledgeIcons";
import { formatBytes } from "./shared";

/** PDF / 图片 / 音视频上传即进入规整与索引，完成后留在待审资料队列。 */
const UPLOAD_FORMATS: Record<string, string> = {
  pdf: "PDF 文档",
  png: "图片 PNG", jpg: "图片 JPG", jpeg: "图片 JPEG", gif: "图片 GIF", webp: "图片 WebP",
  mp3: "音频 MP3", wav: "音频 WAV", m4a: "音频 M4A", aac: "音频 AAC", flac: "音频 FLAC", ogg: "音频 OGG", opus: "音频 OPUS",
  mp4: "视频 MP4", mov: "视频 MOV", webm: "视频 WebM", mkv: "视频 MKV",
};

const ACCEPT = Object.keys(UPLOAD_FORMATS).map((ext) => `.${ext}`).join(",");

type Props = {
  open: boolean;
  inline?: boolean;
  onDirty?: (dirty:boolean)=>void;
  onClose: () => void;
  bases: KnowledgeBaseRow[];
  onCreated: (id: string) => void;
  onProgress?:()=>void;
};

export default function UploadDialog({ open, inline=false,onDirty, onClose, bases: allBases, onCreated,onProgress }: Props) {
  const bases = useMemo(() => allBases.filter((base) => base.kind === "unstructured" && base.status === "active"), [allBases]);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [familyId, setFamilyId] = useState("");
  const [domainId, setDomainId] = useState("");
  const [baseId, setBaseId] = useState("");
  const [error, setError] = useState("");
  const [explanation,setExplanation]=useState('');
  const [explanations,setExplanations]=useState<Record<string,string>>({});

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      setFiles([]);
      setExplanation('');setExplanations({});
      setError("");
      setFamilyId("");
      setDomainId("");
      setBaseId("");
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

  const add = (incoming: File[]) => {
    onDirty?.(true);
    const errors: string[] = [];
    const next = [...files];
    for (const file of incoming) {
      const ext = file.name.split(".").pop()?.toLowerCase() || "";
      if (!UPLOAD_FORMATS[ext]) {
        errors.push(`${file.name}：格式暂不支持`);
        continue;
      }
      if (!file.size) {
        errors.push(`${file.name}：空文件`);
        continue;
      }
      if (next.some((item) => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified)) {
        errors.push(`${file.name}：已在列表中`);
        continue;
      }
      next.push(file);
    }
    setFiles(next);
    setError(errors.join("；"));
  };

  const submit = async () => {
    if (busy || !baseId || !files.length) return;
    setBusy(true); setError("");
    let saved = 0;
    let lastId="";
    try {
      for (const file of files) {
        const result = await api.adminKnowledgeDocumentUpload(baseId, file, false,undefined,explanations[file.name] ?? explanation,reviewCompany());
        saved += 1;
        setFiles((current) => current.filter((item) => item !== file));
        lastId=result.document.id;
        onProgress?.();
      }
      onDirty?.(false);
      if(lastId)onCreated(lastId);else onClose();
    } catch (cause) {
      setError(`已保存 ${saved} 份；${cause instanceof Error ? cause.message : "上传失败"}。剩余文件可重试。`);
    } finally { setBusy(false); }
  };

  const Container=inline ? "div":"dialog";
  return (
    <Container
      ref={inline?undefined:ref as never}
      className={inline?"kbw-upload":"kbv-dialog"}
      data-size="lg"
      data-kbv-upload-dialog
      onClose={() => { if (!busy) onClose(); }}
      onClick={(event) => {
        if (!busy && event.target === ref.current) onClose();
      }}
    >
      <div className="kbv-dialog-head">
        <h2>上传文件</h2>
        <button type="button" className="btn ghost" aria-label="关闭" disabled={busy} onClick={onClose}>
          <KbvIcon name="close" />
        </button>
      </div>
      <div className="kbv-dialog-body">
        <p className="muted">支持批量选择或拖入文件；上传后会自动规整与建立索引，完成后进入待审资料。</p>
        <label>资料用途解释（选填，应用于本批资料）<textarea value={explanation} disabled={busy} maxLength={4000} placeholder="资料讲什么、能回答哪些问题、适用对象及已知限制。保存后可逐份修订。" onChange={e=>{setExplanation(e.target.value);onDirty?.(true);}} /></label>
        <div
          className="kbv-file-info"
          data-kbv-upload-drop
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            if (!busy) add([...event.dataTransfer.files]);
          }}
        >
          <label className="btn">
            选择文件
            <input
              type="file"
              disabled={busy}
              multiple
              accept={ACCEPT}
              data-kbv-upload-pick
              hidden
              onChange={(event) => {
                add([...(event.target.files || [])]);
                event.target.value = "";
              }}
            />
          </label>
          <p className="muted">支持 PDF；归属必须为非结构化知识库。</p>
          <p className="muted">上传会开始解析；解析完成后仍需提交发布审批，不会自动对员工生效。</p>
        </div>
        {files.length ? (
          <div data-kbv-upload-queue>
            {files.map((file, index) => {
              const ext = file.name.split(".").pop()?.toLowerCase() || "";
              return (
                <div className="kbv-file-row" key={`${file.name}-${index}`}>
                  <div>
                    <strong>{file.name}</strong>
                    <p className="muted">{UPLOAD_FORMATS[ext]} · {formatBytes(file.size)} · 待上传</p>
                    <details><summary>覆盖本文件的用途解释</summary><textarea aria-label={`${file.name} 的用途解释`} disabled={busy} maxLength={4000} value={explanations[file.name] ?? explanation} onChange={e=>{setExplanations(current=>({...current,[file.name]:e.target.value}));onDirty?.(true);}} /></details>
                  </div>
                  <button
                    type="button"
                    className="kbv-link-plain"
                    aria-label={`移除 ${file.name}`}
                    disabled={busy}
                    onClick={() => setFiles(files.filter((_, itemIndex) => itemIndex !== index))}
                  >
                    移除
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}
        {error ? <p className="kbv-error" role="alert">{error}</p> : null}
        <div data-kbv-upload-scope>
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

      </div>
      <WorkspaceActions><div className="kbv-dialog-actions">
        <button type="button" className="btn" disabled={busy} onClick={onClose}>取消</button>
        <button
          type="button"
          className="btn work"
          data-kbv-upload-submit
          disabled={busy || !baseId || !files.length}
          onClick={() => void submit()}
        >
          {busy ? "上传并解析中…" : "上传并开始解析"}
        </button>
      </div></WorkspaceActions>
    </Container>
  );
}
