import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { KnowledgeBaseRow } from "../../api";
import { kbBaseKindLabel } from "../../knowledgeCopy";
import KbvIcon from "../../knowledgeIcons";

/** 上传弹窗（P1 壳）：选择/拖入/校验/目标库/队列为真实交互；
 *  「创建文件草稿」按 CONST-10 标注为 P2 接入（上传与提取管线），不伪造结果。 */
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
  const [baseId, setBaseId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      setFiles([]);
      setError("");
      el.showModal();
    }
    if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => {
    if (open && !baseId && bases.length) setBaseId(bases[0].id);
  }, [open, baseId, bases]);

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
        <p className="muted">支持批量选择或拖入文件；每个文件形成一条待整理草稿（P2 接入后）。</p>
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
        <label className="kbv-field">
          <span>统一归档到知识库</span>
          <select data-kbv-upload-base value={baseId} onChange={(event) => setBaseId(event.target.value)}>
            {bases.length === 0 ? <option value="">暂无可用知识库</option> : null}
            {bases.map((base) => (
              <option key={base.id} value={base.id}>
                {base.family_name ? `${base.family_name} / ` : ""}
                {base.domain_name ? `${base.domain_name} / ` : ""}
                {base.name}（{kbBaseKindLabel(base.kind)}）
              </option>
            ))}
          </select>
        </label>
        <p className="muted">
          P2 接入：上传、逐文件状态与提取管线；过渡期请使用
          <Link className="kbv-link-plain" to="/admin/knowledge/ingest">旧版入库（迁移中）</Link>
          。
        </p>
      </div>
      <div className="kbv-dialog-actions">
        <button type="button" className="btn" onClick={onClose}>取消</button>
        <button
          type="button"
          className="btn work"
          data-kbv-upload-submit
          disabled
          title="P2 接入：上传与提取管线"
        >
          创建文件草稿
        </button>
      </div>
    </dialog>
  );
}
