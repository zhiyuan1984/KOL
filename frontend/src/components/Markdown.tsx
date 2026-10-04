import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Root, RootContent, Element } from "hast";

function nodeText(node: RootContent): string {
  return node.type === "text" ? node.value : "children" in node ? node.children.map(nodeText).join("") : "";
}
/** Fold only a normal internal review. Refusals and conflicts stay visible. */
function foldReview() {
  return (tree: Root) => {
    const children = tree.children;
    for (let i = 0; i < children.length; i++) {
      const node = children[i];
      if (node.type !== "element" || !/^(h[1-6]|p)$/.test(node.tagName)
        || nodeText(node).trim() !== "审宪与权限结论") continue;
      const level = /^h[1-6]$/.test(node.tagName) ? Number(node.tagName[1]) : 6;
      let end = i + 1;
      while (end < children.length) {
        const next = children[end];
        if (next.type === "element" && /^h[1-6]$/.test(next.tagName) && Number(next.tagName[1]) <= level) break;
        if (next.type === "element" && next.tagName === "p" && next.children.length === 1
          && next.children[0].type === "element" && next.children[0].tagName === "strong") break;
        end++;
      }
      const section = children.slice(i, end);
      if (/拒绝|无权|缺失|冲突|不符合|违宪|违反|未获授权|需要审批/.test(section.map(nodeText).join(""))) continue;
      const detail: Element = { type: "element", tagName: "details", properties: { className: ["agent-internal-review"] }, children: [
        { type: "element", tagName: "summary", properties: {}, children: [{ type: "text", value: "查看执行检查" }] },
        ...section as Element["children"],
      ] };
      children.splice(i, end - i, detail);
    }
  };
}

export default function Markdown({ children, foldInternalReview = false }: { children: string; foldInternalReview?: boolean }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={foldInternalReview ? [foldReview] : []}>{children}</ReactMarkdown>
    </div>
  );
}
