import { useMemo } from "react";

/**
 * 只读版本对比：结构化字段逐项对照，长文本做行级 diff。
 * 状态不靠颜色单独表达——增删行同时带前缀符号、sr-only 文案与字重/删除线。
 */

export type VersionLike = {
  title?: string;
  subject?: string;
  body?: string;
  body_en?: string;
  stage_codes?: string[] | string;
  brand?: string;
  lang?: string;
};

type DiffKind = "same" | "add" | "del";
type DiffLine = { kind: DiffKind; text: string };

const MAX_DIFF_LINES = 400;

const FIELD_LABELS: { key: keyof VersionLike; label: string }[] = [
  { key: "title", label: "标题" },
  { key: "subject", label: "主题" },
  { key: "brand", label: "品牌" },
  { key: "lang", label: "语言" },
  { key: "stage_codes", label: "适用阶段" },
];

const TEXT_LABELS: { key: "body" | "body_en"; label: string }[] = [
  { key: "body", label: "正文" },
  { key: "body_en", label: "英文正文" },
];

function readField(version: VersionLike, key: keyof VersionLike): string {
  const value = version[key];
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean).join(" / ");
  return String(value ?? "").trim();
}

function splitLines(text?: string): string[] {
  return String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
}

/** 简单 LCS 行级 diff：保留相等行，左侧删行、右侧增行。 */
export function lineDiff(before?: string, after?: string): DiffLine[] {
  const left = splitLines(before).slice(0, MAX_DIFF_LINES);
  const right = splitLines(after).slice(0, MAX_DIFF_LINES);
  const n = left.length;
  const m = right.length;
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i][j] = left[i] === right[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (left[i] === right[j]) {
      out.push({ kind: "same", text: left[i] });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      out.push({ kind: "del", text: left[i] });
      i += 1;
    } else {
      out.push({ kind: "add", text: right[j] });
      j += 1;
    }
  }
  while (i < n) {
    out.push({ kind: "del", text: left[i] });
    i += 1;
  }
  while (j < m) {
    out.push({ kind: "add", text: right[j] });
    j += 1;
  }
  return out;
}

const KIND_LABEL: Record<DiffKind, string> = { same: "未变行", add: "新增行", del: "删除行" };
const KIND_PREFIX: Record<DiffKind, string> = { same: " ", add: "+", del: "-" };

function DiffBlock({ label, lines }: { label: string; lines: DiffLine[] }) {
  const changed = lines.some((line) => line.kind !== "same");
  return (
    <section className="kbadmin-diff-block" data-version-diff-block={label}>
      <h4 className="kbadmin-diff-title">
        {label}
        <span className={"kbadmin-diff-state" + (changed ? " is-changed" : "")}>
          {changed ? "有变化" : "无变化"}
        </span>
      </h4>
      <ol className="kbadmin-diff-lines">
        {lines.map((line, index) => (
          <li
            key={`${index}-${line.kind}`}
            className={`kbadmin-diff-line is-${line.kind}`}
            data-diff-kind={line.kind}
          >
            <span className="kbadmin-diff-prefix" aria-hidden="true">{KIND_PREFIX[line.kind]}</span>
            <span className="sr-only">{KIND_LABEL[line.kind]}：</span>
            <span className="kbadmin-diff-text">{line.text || " "}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function VersionDiff({
  left,
  right,
  leftLabel = "旧版本",
  rightLabel = "新版本",
}: {
  left: VersionLike;
  right: VersionLike;
  leftLabel?: string;
  rightLabel?: string;
}) {
  const fields = useMemo(
    () => FIELD_LABELS.map((field) => ({
      ...field,
      before: readField(left, field.key),
      after: readField(right, field.key),
    })),
    [left, right],
  );
  const texts = useMemo(
    () => TEXT_LABELS.map((field) => ({
      ...field,
      lines: lineDiff(String(left[field.key] ?? ""), String(right[field.key] ?? "")),
    })),
    [left, right],
  );

  return (
    <div className="kbadmin-diff" data-version-diff>
      <div className="admin-table-wrap">
        <table className="admin-table kbadmin-diff-table">
          <caption className="sr-only">{`${leftLabel} 与 ${rightLabel} 的结构化字段对照`}</caption>
          <thead>
            <tr>
              <th scope="col">字段</th>
              <th scope="col">{leftLabel}</th>
              <th scope="col">{rightLabel}</th>
              <th scope="col">结果</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((field) => {
              const changed = field.before !== field.after;
              return (
                <tr key={field.key} data-version-diff-field={field.key}>
                  <th scope="row">{field.label}</th>
                  <td>{field.before || "（空）"}</td>
                  <td>{field.after || "（空）"}</td>
                  <td data-diff-state={changed ? "changed" : "same"}>{changed ? "有变化" : "相同"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {texts.map((text) => (
        <DiffBlock key={text.key} label={text.label} lines={text.lines} />
      ))}
      <p className="muted kbadmin-diff-note">
        对比只读，不会写入。每侧最多对照前 {MAX_DIFF_LINES} 行；超出部分保持原样，请回版本全文查看。
      </p>
    </div>
  );
}
