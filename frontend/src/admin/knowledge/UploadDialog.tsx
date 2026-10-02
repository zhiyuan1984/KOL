import { useEffect, useMemo, useRef, useState } from "react";
import type { KnowledgeBaseRow } from "../../api";
import ScopeTabs, { type ScopeOption } from "../../components/ScopeTabs";
import StageTags from "../../components/StageTags";
import KbvIcon from "../../knowledgeIcons";

/** 上传弹窗：选择 / 拖入 / 校验 / 归档目标（业务域→业务主题→知识库三级 tab）/ 适用阶段标签 / 队列为真实交互；
 *  提交在后端上传通道接入前保持禁用（不出现工程阶段话术）。 */
const UPLOAD_FORMATS: Record<string, string> = {
  pdf: "PDF 文档",
  doc: "Word 文档", docx: "Word 文档",
  xls: "Excel 表格", xlsx: "Excel 表格", csv: "CSV 表格",
  ppt: "演示文稿", pptx: "演示文稿",
  txt: "纯文本", md: "Markdown", html: "HTML 文档",
  png: "图片 / 待 OCR", jpg: "图片 / 待 OCR", jpeg: "图片 / 待 OCR", webp: "图片 / 待 OCR",
  mp3: "音频 / 待转写", m4a: "音频 / 待转写", wav: "音频 / 待转写",
  mp4: "视频 / 待转写", mov: "视频 / 待转写", webm: "视频 / 待转写",
};

const ACCEPT = Object.keys(UPLOAD_FORMATS).map((ext) => `.${ext}`).join(",");

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1048576) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1048576).toFixed(1)} MB`;
}

type Props = {
  open: boolean;
  onClose: () => void;
  bases: KnowledgeBaseRow[];
};

export default function UploadDialog({ open, onClose, bases }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [familyId, setFamilyId] = useState("");
  const [domainId, setDomainId] = useState("");
  const [baseId, setBaseId] = useState("");
  const [stages, setStages] = useState<string[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      setFiles([]);
      setError("");
      setFamilyId("");
      setDomainId("");
      setBaseId("");
      setStages([]);
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

  return (
    <dialog
      ref={ref}
      className="kbv-dialog"
      data-kbv-upload-dialog
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="kbv-dialog-head">
        <h2>上传文件</h2>
        <button type="button" className="btn ghost" aria-label="关闭" onClick={onClose}>
          <KbvIcon name="close" />
        </button>
      </div>
      <div className="kbv-dialog-body">
        <p className="muted">支持批量选择或拖入文件；每个文件形成一条待整理草稿。</p>
        <div
          className="kbv-file-info"
          data-kbv-upload-drop
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            add([...event.dataTransfer.files]);
          }}
        >
          <label className="btn">
            选择文件
            <input
              type="file"
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
          <p className="muted">PDF · Word · Excel / CSV · PowerPoint · TXT / Markdown / HTML · 图片（PNG/JPG/WEBP）· 音视频（MP3/M4A/WAV/MP4/MOV/WEBM）</p>
          <p className="muted">音视频将先转写；扫描件将先 OCR。</p>
        </div>
        {files.length ? (
          <div data-kbv-upload-queue>
            {files.map((file, index) => {
              const ext = file.name.split(".").pop()?.toLowerCase() || "";
              return (
                <div className="kbv-file-row" key={`${file.name}-${index}`}>
                  <div>
                    <strong>{file.name}</strong>
                    <p className="muted">{UPLOAD_FORMATS[ext]} · {formatSize(file.size)} · 待上传</p>
                  </div>
                  <button
                    type="button"
                    className="kbv-link-plain"
                    aria-label={`移除 ${file.name}`}
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
        <StageTags selected={stages} onChange={setStages} />
      </div>
      <div className="kbv-dialog-actions">
        <button type="button" className="btn" onClick={onClose}>取消</button>
        <button
          type="button"
          className="btn work"
          data-kbv-upload-submit
          disabled
        >
          创建文件草稿
        </button>
      </div>
    </dialog>
  );
}
