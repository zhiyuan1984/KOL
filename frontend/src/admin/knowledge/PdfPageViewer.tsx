import { Alert, Button, InputNumber } from 'antd';
import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

/** PDF.js owns PDF parsing/fonts/page coordinates. This adapter only chooses the
 * actual container viewport, page and zoom; never reconstructs extracted text. */
export default function PdfPageViewer({ url, title, refreshKey = 0 }: { url: string; title: string; refreshKey?: number }) {
  const host = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1), [width, setWidth] = useState(0), [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(true), [rendering, setRendering] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    if (!host.current) return;
    const measure = () => setWidth(Math.floor(host.current!.clientWidth));
    measure(); const observer = new ResizeObserver(measure); observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    // jsdom does not expose window.fetch/canvas/worker; actual browser evidence
    // remains mandatory and is not replaced by this component test environment.
    if (!window.fetch) return;
    let cancelled = false;
    let destroy: (() => Promise<void>) | undefined;
    setPdf(null); setPage(1); setZoom(1); setError(''); setLoading(true);
    void import('pdfjs-dist').then(async library => {
      if (cancelled) return;
      library.GlobalWorkerOptions.workerSrc = workerUrl;
      const task = library.getDocument({ url, withCredentials: true, disableRange: true, disableStream: true, isEvalSupported: false });
      destroy = () => task.destroy();
      const document = await task.promise;
      if (!cancelled) setPdf(document);
    }).catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'PDF 原页读取失败'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; void destroy?.().catch(() => {}); };
  }, [url, refreshKey]);
  useEffect(() => {
    if (!pdf || !canvas.current || width < 1) return;
    let cancelled = false, task: RenderTask | undefined;
    setRendering(true); setError('');
    void pdf.getPage(page).then(async original => {
      if (cancelled || !canvas.current) return;
      const base = original.getViewport({ scale: 1 });
      const viewport = original.getViewport({ scale: (width / base.width) * zoom });
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const element = canvas.current;
      const context = element.getContext('2d');
      if (!context) throw new Error('浏览器不能渲染 PDF 原页，请使用新窗口或原件入口');
      element.width = Math.ceil(viewport.width * ratio); element.height = Math.ceil(viewport.height * ratio);
      element.style.width = `${viewport.width}px`; element.style.height = `${viewport.height}px`;
      task = original.render({ canvas: element, canvasContext: context, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
      await task.promise;
    }).catch(cause => { if (!cancelled && cause?.name !== 'RenderingCancelledException') setError(cause instanceof Error ? cause.message : 'PDF 原页渲染失败'); })
      .finally(() => { if (!cancelled) setRendering(false); });
    return () => { cancelled = true; task?.cancel(); };
  }, [pdf, page, width, zoom]);
  return <div className="kbpilot-pdf" data-pdf-source={url} aria-label={`${title} 原页阅读器`}>
    <div className="kbpilot-pdf-controls" aria-label="原页导航与缩放">
      <Button type="text" disabled={!pdf || page <= 1} onClick={() => setPage(value => value - 1)}>上一页</Button>
      <label>第 <InputNumber aria-label="原件页码" min={1} max={pdf?.numPages || 1} precision={0} value={page} disabled={!pdf} onChange={value => { if (value != null) setPage(Math.min(pdf?.numPages || 1, Math.max(1, Number(value)))); }} /> / {pdf?.numPages ?? '—'} 页</label>
      <Button type="text" disabled={!pdf || page >= pdf.numPages} onClick={() => setPage(value => value + 1)}>下一页</Button>
      <Button type="text" aria-label="缩小原页" disabled={!pdf || zoom <= 0.5} onClick={() => setZoom(value => Math.max(0.5, value - 0.25))}>缩小</Button>
      <Button type="text" disabled={!pdf} onClick={() => setZoom(1)}>适合页宽</Button>
      <Button type="text" aria-label="放大原页" disabled={!pdf || zoom >= 2} onClick={() => setZoom(value => Math.min(2, value + 0.25))}>放大</Button>
    </div>
    {loading || rendering ? <p role="status">{loading ? '正在读取 PDF 原件页…' : '正在按容器渲染原页…'}</p> : null}
    {error ? <Alert type="warning" showIcon title="PDF 原页不可用" description={`${error}。请重新读取预览，或使用新窗口与原件入口。`} /> : null}
    <div className="kbpilot-pdf-canvas" ref={host}>
      <canvas ref={canvas} aria-label={`${title} 原件第 ${page} 页`} role="img" hidden={!pdf || Boolean(error)} data-rendered={pdf && !rendering && !error ? 'true' : 'false'} />
    </div>
  </div>;
}
