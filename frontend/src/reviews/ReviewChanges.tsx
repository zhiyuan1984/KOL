import { useEffect, useState } from "react";
import { reviewApi } from "./api";
import type { ReviewDraft, ReviewIssue } from "../../../shared/review";
type Change = { path: string; before: unknown; after: unknown };
const labels: Record<string, string> = {
  organizationUnitId: "流程归属组织",
  name: "名称",
  description: "说明",
  id: "标识",
  label: "字段名称",
  type: "类型",
  required: "必填",
  options: "选项",
  numeric: "精确数值规则",
  precision: "总精度",
  scale: "小数位",
  min: "下限",
  max: "上限",
  currencies: "允许币种",
  currencySource: "币种及金额规则来源",
  amount: "金额",
  currency: "币种",
  next: "下一节点",
  otherwise: "不满足时",
  condition: "条件",
  conditions: "子条件",
  field: "字段",
  op: "比较方式",
  value: "比较值",
  assignee: "人员来源",
  kind: "来源方式",
  userIds: "指定人员",
  role: "授权角色",
  mode: "处理方式",
  reject: "拒绝规则",
  timeoutHours: "时限（小时）",
  operations: "后续操作",
  transfer: "转交",
  countersign: "加签",
  amendment: "补充材料",
  timeout: "超时策略",
  candidates: "候选人员",
  deadline: "期限规则",
  restart: "重新开始位置",
  fields: "字段",
  x: "横向位置",
  y: "纵向位置",
};
function Value({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span>无</span>;
  if (Array.isArray(value))
    return (
      <ul>
        {value.map((v, i) => (
          <li key={i}>
            <Value value={v} />
          </li>
        ))}
      </ul>
    );
  if (typeof value === "object")
    return (
      <dl>
        {Object.entries(value).map(([key, v]) => (
          <div key={key}>
            <dt>{labels[key] || key}</dt>
            <dd>
              <Value value={v} />
            </dd>
          </div>
        ))}
      </dl>
    );
  return (
    <span>
      {typeof value === "boolean" ? (value ? "是" : "否") : String(value)}
    </span>
  );
}
function Changes({ changes }: { changes: Change[] }) {
  return (
    <ul>
      {changes.map((c) => (
        <li key={c.path}>
          <strong>
            {c.path.endsWith(".order")
              ? c.path.startsWith("fields")
                ? "字段顺序"
                : "节点顺序"
              : labels[c.path] ||
                String(
                  (c.after as { label?: string; name?: string })?.label ||
                    (c.after as { name?: string })?.name ||
                    (c.before as { label?: string; name?: string })?.label ||
                    (c.before as { name?: string })?.name ||
                    c.path,
                )}
          </strong>
          <details>
            <summary>查看变更前后</summary>
            <div>
              原值：
              <Value value={c.before} />
            </div>
            <div>
              新值：
              <Value value={c.after} />
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}
export function PublishChanges({
  id,
  version,
}: {
  id: string;
  version: number;
}) {
  const [data, setData] = useState<{
      publishedVersion: number | null;
      changes: Change[];
    }>(),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    setData(undefined);
    setError("");
    reviewApi<{ publishedVersion: number | null; changes: Change[] }>(
      `/admin/approval-types/v2/templates/${id}/diff`,
    )
      .then((d) => {
        if (live) setData(d);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [id, version, retry]);
  return (
    <section aria-label="发布差异">
      <h3>相对已发布版本的变更</h3>
      {error ? (
        <p role="alert">
          {error}
          <button onClick={() => setRetry(retry + 1)}>重试差异加载</button>
        </p>
      ) : !data ? (
        <p>正在读取已保存版本的差异…</p>
      ) : (
        <>
          <p>
            {data.publishedVersion
              ? `对比 v${data.publishedVersion} → 草稿 v${version}`
              : "首次发布"}{" "}
            · {data.changes.length} 项变更
          </p>
          <Changes changes={data.changes} />
        </>
      )}
    </section>
  );
}
export function UpgradeDraft({
  id,
  onClose,
  onSaved,
}: {
  id: string;
  onClose: () => void;
  onSaved: (d: ReviewDraft) => Promise<void>;
}) {
  const [data, setData] = useState<{
      source: ReviewDraft;
      templateVersion: number;
      omitted: {
        field: string;
        label: string;
        value: unknown;
        reason: string;
      }[];
      changes: Change[];
      issues: ReviewIssue[];
    }>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    setError("");
    setData(undefined);
    reviewApi<NonNullable<typeof data>>(`/approvals/v2/drafts/${id}/upgrade`)
      .then((d) => {
        if (live) setData(d);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [id, retry]);
  return (
    <section aria-label="草稿升级预览">
      <h2>使用新流程恢复草稿</h2>
      {error && (
        <p role="alert">
          {error}
          <button onClick={() => setRetry(retry + 1)}>重新加载</button>
        </p>
      )}
      {data ? (
        <>
          <p>
            流程 v{data.source.templateVersion} → v{data.templateVersion}
            。兼容字段将复制到新草稿，原草稿保留。
          </p>
          <Changes changes={data.changes} />
          {data.omitted.length > 0 && (
            <>
              <h3>无法自动迁移的原材料</h3>
              <ul>
                {data.omitted.map((o) => (
                  <li key={o.field}>
                    {o.label}：{JSON.stringify(o.value)}（{o.reason}）
                  </li>
                ))}
              </ul>
            </>
          )}
          {data.issues.length > 0 && (
            <p>
              复制后仍须补齐：{data.issues.map((i) => i.message).join("；")}
            </p>
          )}
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const d = await reviewApi<ReviewDraft>(
                  `/approvals/v2/drafts/${id}/upgrade`,
                  {
                    expectedVersion: data.source.version,
                    targetVersion: data.templateVersion,
                  },
                );
                await onSaved(d);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            复制兼容材料到新草稿
          </button>
        </>
      ) : (
        !error && <p>正在核对字段和版本…</p>
      )}
      <button disabled={busy} onClick={onClose}>
        返回草稿列表
      </button>
    </section>
  );
}
