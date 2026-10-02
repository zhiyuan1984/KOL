#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""PageIndex 本地侧车（知识非结构化层，P1）。

Node 只通过 stdout 单行 JSON 契约调用本脚本（契约见
docs/superpowers/specs/2026-10-02-knowledge-unstructured-pageindex-design.md §7.2）：

  ping
  index     --input <normalized.pdf> --library <dir> [--index-model <m>]
  ask       --library <dir> --question <q> [--chat-model <m>] [--doc-id <id>]... [--citations]
  render    --input <pdf> --out <dir>              # 逐页渲染 PNG（扫描件 OCR 用）
  make-pdf  --text <file> --out <file.pdf>         # 文本 → 文本型 PDF（reportlab，CJK 用 CID 字体）
  remove    --library <dir> --doc-id <id>          # 删除库内某文档索引（资料删除时清理）

约定：成功与可预期失败都以退出码 0 + 一行 JSON 输出：
  {"ok": true, ...} / {"ok": false, "code": "...", "message": "..."}
进程级异常（缺包、崩溃）由 Node 侧映射为 knowledge_index_unavailable。日志一律走 stderr。
本地库目录：以 --library 为准（设置 PAGEINDEX_HOME 并在该目录内工作）；SDK 本地存储的
具体机制在试点首日实测后固定，见 tools/pageindex-bridge/README.md「试点待办」。
"""
import argparse
import json
import os
import sys
import time


def emit(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def fail(code, message):
    emit({"ok": False, "code": code, "message": message})
    return 0


def local_client(library, index_model=None, chat_model=None):
    from pageindex import PageIndexClient
    library = os.path.abspath(library)
    os.makedirs(library, exist_ok=True)
    os.environ["PAGEINDEX_HOME"] = library
    return PageIndexClient(
        index=index_model or os.environ.get("KNOWLEDGE_INDEX_MODEL") or "gpt-5.6-luna",
        chat=chat_model or os.environ.get("KNOWLEDGE_CHAT_MODEL") or "gpt-5.6-sol",
    )


def cmd_index(args):
    started = time.time()
    try:
        client = local_client(args.library, index_model=args.index_model)
    except Exception as exc:
        return fail("knowledge_index_unavailable", "pageindex 未安装：%s" % exc)
    try:
        result = client.submit_document(os.path.abspath(args.input), wait=True)
        doc_id = result.get("doc_id") or result.get("id")
        pages = int(result.get("pageNum") or 0)
        try:
            tree = client.get_tree(doc_id)
            with open(os.path.join(args.library, "%s.tree.json" % doc_id), "w", encoding="utf-8") as fh:
                json.dump(tree, fh, ensure_ascii=False)
        except Exception:
            pass
        emit({"ok": True, "doc_id": doc_id, "pages": pages, "elapsed_ms": int((time.time() - started) * 1000)})
    except Exception as exc:
        return fail("knowledge_index_failed", str(exc)[:500])
    return 0


def cmd_ask(args):
    try:
        client = local_client(args.library, chat_model=args.chat_model)
    except Exception as exc:
        return fail("knowledge_index_unavailable", "pageindex 未安装：%s" % exc)
    try:
        kwargs = {}
        if args.doc_id:
            kwargs["doc_id"] = args.doc_id[0] if len(args.doc_id) == 1 else args.doc_id
        if args.citations:
            kwargs["citations"] = True
        answer = client.chat(args.question, **kwargs)
        citations = []
        if args.citations:
            try:
                resolved = client.resolve_citations(answer)
                answer = resolved.get("answer", answer)
                for item in resolved.get("citations", []) or []:
                    citations.append({
                        "document": item.get("document"),
                        "doc_id": item.get("doc_id"),
                        "page": item.get("page"),
                    })
            except Exception:
                pass
        emit({"ok": True, "answer": answer, "citations": citations})
    except Exception as exc:
        return fail("knowledge_ask_failed", str(exc)[:500])
    return 0


def cmd_render(args):
    try:
        import pypdfium2 as pdfium
    except Exception as exc:
        return fail("knowledge_index_unavailable", "pypdfium2 缺失：%s" % exc)
    os.makedirs(args.out, exist_ok=True)
    try:
        pdf = pdfium.PdfDocument(args.input)
        total = len(pdf)
        for index in range(total):
            page = pdf[index]
            bitmap = page.render(scale=2)
            image = bitmap.to_pil()
            image.save(os.path.join(args.out, "page-%d.png" % (index + 1)))
            page.close()
        emit({"ok": True, "pages": total})
    except Exception as exc:
        return fail("knowledge_index_failed", str(exc)[:500])
    return 0


def cmd_make_pdf(args):
    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import ParagraphStyle
        from reportlab.lib.units import mm
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.cidfonts import UnicodeCIDFont
        from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer
    except Exception as exc:
        return fail("knowledge_index_unavailable", "reportlab 缺失：%s" % exc)
    try:
        with open(args.text, encoding="utf-8") as fh:
            raw = fh.read()
        pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
        body = ParagraphStyle("body", fontName="STSong-Light", fontSize=10, leading=15)
        heading = ParagraphStyle("heading", fontName="STSong-Light", fontSize=13, leading=19, spaceBefore=6)
        doc = SimpleDocTemplate(
            args.out, pagesize=A4,
            leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm, bottomMargin=16 * mm,
        )
        story = []
        for line in raw.splitlines():
            text = line.rstrip()
            if not text:
                story.append(Spacer(1, 5))
                continue
            escaped = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            if text.startswith("#"):
                story.append(Paragraph(escaped.lstrip("# ").strip(), heading))
            else:
                story.append(Paragraph(escaped, body))
        doc.build(story)
        emit({"ok": True})
    except Exception as exc:
        return fail("knowledge_index_failed", str(exc)[:500])
    return 0


def cmd_remove(args):
    try:
        client = local_client(args.library)
    except Exception as exc:
        return fail("knowledge_index_unavailable", "pageindex 未安装：%s" % exc)
    try:
        try:
            client.delete_document(args.doc_id)
        except Exception:
            pass
        emit({"ok": True})
    except Exception as exc:
        return fail("knowledge_index_failed", str(exc)[:500])
    return 0


def main():
    parser = argparse.ArgumentParser(prog="pageindex-bridge")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("ping")
    p_index = sub.add_parser("index")
    p_index.add_argument("--input", required=True)
    p_index.add_argument("--library", required=True)
    p_index.add_argument("--index-model", dest="index_model", default="")
    p_ask = sub.add_parser("ask")
    p_ask.add_argument("--library", required=True)
    p_ask.add_argument("--question", required=True)
    p_ask.add_argument("--chat-model", dest="chat_model", default="")
    p_ask.add_argument("--doc-id", dest="doc_id", action="append", default=[])
    p_ask.add_argument("--citations", action="store_true")
    p_render = sub.add_parser("render")
    p_render.add_argument("--input", required=True)
    p_render.add_argument("--out", required=True)
    p_make = sub.add_parser("make-pdf")
    p_make.add_argument("--text", required=True)
    p_make.add_argument("--out", required=True)
    p_remove = sub.add_parser("remove")
    p_remove.add_argument("--library", required=True)
    p_remove.add_argument("--doc-id", dest="doc_id", required=True)
    args = parser.parse_args()
    try:
        if args.cmd == "ping":
            try:
                import pageindex
                emit({"ok": True, "python": sys.version.split()[0], "pageindex": getattr(pageindex, "__version__", "unknown")})
            except Exception as exc:
                return fail("knowledge_index_unavailable", "pageindex 未安装：%s" % exc)
            return 0
        if args.cmd == "index":
            return cmd_index(args)
        if args.cmd == "ask":
            return cmd_ask(args)
        if args.cmd == "render":
            return cmd_render(args)
        if args.cmd == "make-pdf":
            return cmd_make_pdf(args)
        if args.cmd == "remove":
            return cmd_remove(args)
        return fail("knowledge_index_unavailable", "未知命令 %s" % args.cmd)
    except Exception as exc:  # 兜底：绝不让异常以非 JSON 输出崩溃
        return fail("knowledge_index_failed", str(exc)[:500])


if __name__ == "__main__":
    sys.exit(main())
