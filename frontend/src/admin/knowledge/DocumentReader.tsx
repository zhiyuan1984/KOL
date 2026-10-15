import { Alert, Button, Tabs } from "antd";
import { useEffect, useState } from "react";
import PdfPageViewer from "./PdfPageViewer";
import "./knowledge-pilot.css";

export type DocumentTextPreview = { name: string; text: string };

export function documentAssetUrl(id: string, asset: "file" | "preview", company = "") {
  const query = company ? `?${new URLSearchParams({ company }).toString()}` : "";
  return `/api/admin/knowledge/documents/${encodeURIComponent(id)}/${asset}${query}`;
}

export function canUseDocumentPreview(mediaType?: string, artifacts?: Record<string, unknown> | null) {
  return mediaType === "pdf" || (mediaType === "pptx" && Boolean(artifacts?.normalize));
}

export default function DocumentReader({
  id,
  title,
  mediaType,
  artifacts,
  company,
  textPreview,
  sourceRevision,
}: {
  id: string;
  title: string;
  mediaType?: string;
  artifacts?: Record<string, unknown> | null;
  company?: string;
  textPreview?: DocumentTextPreview | null;
  sourceRevision?: string;
}) {
  const previewAvailable = canUseDocumentPreview(mediaType, artifacts);
  const fileUrl = documentAssetUrl(id, "file", company);
  const basePreviewUrl = documentAssetUrl(id, "preview", company);
  const previewUrl = sourceRevision ? `${basePreviewUrl}${company ? "&" : "?"}revision=${encodeURIComponent(sourceRevision)}` : basePreviewUrl;
  const initial = previewAvailable ? "original" : "text";
  const [mode, setMode] = useState(initial);
  const [previewError, setPreviewError] = useState("");
  const [previewChecking, setPreviewChecking] = useState(false);
  const [previewRead, setPreviewRead] = useState(0);
  useEffect(() => setMode(previewAvailable ? "original" : "text"), [id, previewAvailable]);
  useEffect(() => {
    if (!previewAvailable || !window.fetch || mode !== "original") return;
    const controller = new AbortController();
    let cancelled = false;
    setPreviewError(""); setPreviewChecking(true);
    const timeout = window.setTimeout(() => controller.abort(new Error("预览状态读取超时")), 12000);
    // Hono GET file routes support HEAD. Do not download a large PDF merely
    // to discover a missing asset or revoked permission; no automatic replay.
    void window.fetch(previewUrl, { method: "HEAD", credentials: "same-origin", signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error(`预览读取失败（HTTP ${response.status}）`); })
      .catch(error => { if (!cancelled) setPreviewError(error instanceof Error ? error.message : "预览读取失败"); })
      .finally(() => { if (!cancelled) setPreviewChecking(false); window.clearTimeout(timeout); });
    return () => { cancelled = true; controller.abort(); window.clearTimeout(timeout); };
  }, [previewAvailable, previewUrl, previewRead, mode]);
  const originalName = mediaType === "pptx" ? "原件预览（逐页 PDF）" : "原件预览（PDF）";

  return <section className="kbpilot-reader" aria-label="资料阅读">
    <h3>资料阅读</h3>
    <Tabs activeKey={mode} onChange={setMode} size="small" items={[
      {
        key: "original",
        label: "原件预览",
        children: previewAvailable ? <div className="kbpilot-original-preview">
          <p>{originalName}使用 PDF.js 按真实页尺寸和当前容器渲染，保留页码、缩放和页面比例；提取文本不代表原件版式。若阅读区空白或浏览器不支持 PDF，请在新窗口打开预览或查看原件。</p>
          {mediaType === "pptx" && <p role="note">转换 PDF 可能存在字体或换行差异；有疑问请查看 PPTX 原件。未逐页核验的转换结果不代表已验证原件保真。</p>}
          <div className="kbpilot-reader-actions">
            <Button type="link" href={previewUrl} target="_blank" rel="noreferrer">在新窗口打开{originalName}</Button>
            <Button type="link" href={fileUrl} target="_blank" rel="noreferrer">查看{mediaType === "pptx" ? " PPTX 原件" : " PDF 原件"}</Button>
          </div>
          {previewChecking ? <p role="status">正在读取预览可用状态…</p> : null}
          {previewError ? <Alert type="warning" showIcon title="原件预览读取失败"
            description={`${previewError}。请重新读取，或使用原件与提取文本入口；不会将空白阅读区当作已验证预览。`}
            action={<Button type="text" disabled={previewChecking} onClick={() => setPreviewRead(value => value + 1)}>重新读取预览</Button>} /> : null}
          <PdfPageViewer key={id} url={previewUrl} title={title} refreshKey={previewRead} />
          {!previewChecking && !previewError ? <Button type="text" onClick={() => setPreviewRead(value => value + 1)}>重新读取预览</Button> : null}
        </div> : <Alert
          type="warning"
          showIcon
          title="原件预览不可用"
          description={mediaType === "pptx" ? "尚未获得可逐页阅读的转换 PDF；提取文本不保留幻灯片版式。" : "当前资料没有可用的浏览器原件预览；提取文本不代表原件版式。"}
          action={<Button type="link" href={fileUrl} target="_blank" rel="noreferrer">打开原件</Button>}
        />,
      },
      {
        key: "text",
        label: "提取文本",
        children: textPreview?.text ? <article className="kbpilot-text-reader">
          <p><strong>提取文本</strong>{textPreview.name ? ` · ${textPreview.name}` : ""}。用于可读、可检索地核对内容，不保留原件页面版式。</p>
          <pre>{textPreview.text}</pre>
        </article> : <Alert
          type="info"
          showIcon
          title="尚无提取文本"
          description="资料尚未生成可读文本，或提取文本不可用。请使用原件入口核对内容。"
          action={<Button type="link" href={fileUrl} target="_blank" rel="noreferrer">打开原件</Button>}
        />,
      },
    ]} />
  </section>;
}
