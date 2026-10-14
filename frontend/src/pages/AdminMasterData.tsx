import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Card, Descriptions, Empty, Modal, Select, Steps, Table, Tag, Upload } from "antd";
import type { UploadProps } from "antd";
import type { RcFile } from "antd/es/upload";

/**
 * 管理端 · 主数据导入（2026-10-12）。
 * 企业级业务本体 Track C（C1 Excel 导入链路）：主数据权威源 = Excel。
 * 流程：选择类型 → 下载模板 → 上传 → 校验预览 → 确认导入 → 查看记录。
 * 导入是 R3 动作：preview 与 commit 分开，commit 前 Modal.confirm 二次确认。
 */

type MasterDataField = {
  key: string;
  label: string;
  required: boolean;
  example: string;
};

type MasterDataKind = {
  kind: string;
  label: string;
  domain: string;
  owner: string;
  code_key: string;
  fields: MasterDataField[];
};

type PreviewRow = {
  line: number;
  code: string;
  name: string;
  valid: boolean;
  errors: string[];
  data: Record<string, string>;
};

type PreviewResult = {
  kind: string;
  label: string;
  header: string[];
  total: number;
  valid: number;
  invalid: number;
  errors: string[];
  rows: PreviewRow[];
  truncated: boolean;
};

type CommitResult = {
  ok: boolean;
  batch_id: string;
  kind: string;
  inserted: number;
  updated: number;
  skipped: Array<{ line: number; reason: string }>;
  event_id: string;
};

type RecordRow = {
  kind: string;
  code: string;
  name: string;
  attrs: Record<string, string>;
  status: string;
  source: string;
  batch_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "include", ...init });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || `请求失败（${res.status}）`);
  }
  return res.json() as Promise<T>;
}

const STEP_ITEMS = ["选择类型", "下载模板", "上传文件", "校验预览", "确认导入"];

export default function AdminMasterData() {
  const [kinds, setKinds] = useState<MasterDataKind[]>([]);
  const [kind, setKind] = useState<string>("");
  const [step, setStep] = useState(0);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<CommitResult | null>(null);
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);

  const selected = kinds.find((k) => k.kind === kind) ?? null;

  useEffect(() => {
    apiJson<{ kinds: MasterDataKind[] }>("/api/admin/master-data/kinds")
      .then((r) => setKinds(r.kinds))
      .catch((e) => setError(e.message));
  }, []);

  const loadRecords = useCallback(() => {
    if (!kind) return;
    setRecordsLoading(true);
    apiJson<{ records: RecordRow[] }>(`/api/admin/master-data/records?kind=${encodeURIComponent(kind)}&limit=100`)
      .then((r) => setRecords(r.records))
      .catch((e) => setError(e.message))
      .finally(() => setRecordsLoading(false));
  }, [kind]);

  useEffect(() => {
    if (step >= 4) loadRecords();
  }, [step, loadRecords]);

  const handleKindChange = (value: string) => {
    setKind(value);
    setStep(1);
    setPreview(null);
    setReceipt(null);
    setError("");
  };

  const downloadTemplate = () => {
    window.open(`/api/admin/master-data/template/${encodeURIComponent(kind)}`, "_blank");
    setStep(2);
  };

  const uploadProps: UploadProps = {
    accept: ".csv",
    showUploadList: false,
    beforeUpload: async (file: RcFile) => {
      setError("");
      setUploading(true);
      try {
        const form = new FormData();
        form.append("kind", kind);
        form.append("file", file);
        const result = await apiJson<PreviewResult>("/api/admin/master-data/preview", {
          method: "POST",
          body: form,
        });
        setPreview(result);
        setStep(3);
      } catch (e) {
        setError(e instanceof Error ? e.message : "上传失败");
      } finally {
        setUploading(false);
      }
      return false;
    },
  };

  const handleCommit = () => {
    if (!preview) return;
    const validRows = preview.rows.filter((r) => r.valid);
    Modal.confirm({
      title: `确认导入${preview.label}主数据？`,
      content: `共 ${preview.total} 行，其中 ${validRows.length} 行校验通过将被导入（新增或按编码更新），${preview.invalid} 行将被跳过。此操作不可撤销。`,
      okText: "确认导入",
      cancelText: "取消",
      onOk: async () => {
        setCommitting(true);
        setError("");
        try {
          const result = await apiJson<CommitResult>("/api/admin/master-data/commit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kind, rows: preview.rows }),
          });
          setReceipt(result);
          setStep(4);
        } catch (e) {
          setError(e instanceof Error ? e.message : "导入失败");
        } finally {
          setCommitting(false);
        }
      },
    });
  };

  const previewColumns = [
    { title: "行号", dataIndex: "line", key: "line", width: 64 },
    { title: "编码", dataIndex: "code", key: "code", width: 140 },
    { title: "名称", dataIndex: "name", key: "name", width: 180 },
    {
      title: "校验",
      key: "valid",
      width: 90,
      render: (_: unknown, row: PreviewRow) =>
        row.valid ? <Tag color="green">通过</Tag> : <Tag color="red">不通过</Tag>,
    },
    {
      title: "错误",
      key: "errors",
      render: (_: unknown, row: PreviewRow) => row.errors.join("；") || "—",
    },
  ];

  const recordColumns = [
    { title: "编码", dataIndex: "code", key: "code", width: 150 },
    { title: "名称", dataIndex: "name", key: "name", width: 200 },
    {
      title: "属性",
      key: "attrs",
      render: (_: unknown, row: RecordRow) =>
        Object.entries(row.attrs || {})
          .map(([k, v]) => `${k}=${v}`)
          .join("；") || "—",
    },
    { title: "更新时间", dataIndex: "updated_at", key: "updated_at", width: 180 },
  ];

  return (
    <div style={{ padding: 16, maxWidth: 1100 }}>
      <h2 style={{ marginBottom: 4 }}>主数据导入</h2>
      <p style={{ color: "#666", marginBottom: 16 }}>
        企业级业务本体 C1 链路：主数据权威源为 Excel。流程：下载模板 → 用 Excel 填写 → 上传 CSV → 校验预览 → 确认导入。
      </p>

      {error && (
        <Alert type="error" message={error} closable onClose={() => setError("")} style={{ marginBottom: 16 }} />
      )}

      <Card title="导入流程" style={{ marginBottom: 16 }}>
        <Steps current={step} items={STEP_ITEMS.map((t) => ({ title: t }))} style={{ marginBottom: 16 }} />
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <span>主数据类型：</span>
          <Select
            style={{ width: 220 }}
            placeholder="选择主数据类型"
            value={kind || undefined}
            onChange={handleKindChange}
            options={kinds.map((k) => ({ value: k.kind, label: `${k.label}（${k.domain}）` }))}
          />
          {selected && (
            <Button type="primary" onClick={downloadTemplate}>
              下载模板
            </Button>
          )}
          {step >= 2 && kind && (
            <Upload {...uploadProps}>
              <Button loading={uploading}>上传 CSV 文件</Button>
            </Upload>
          )}
        </div>
        {selected && (
          <Descriptions size="small" column={3} style={{ marginTop: 16 }}>
            <Descriptions.Item label="所属域">{selected.domain}</Descriptions.Item>
            <Descriptions.Item label="域主">{selected.owner}</Descriptions.Item>
            <Descriptions.Item label="唯一键">{selected.code_key}</Descriptions.Item>
          </Descriptions>
        )}
      </Card>

      {preview && step >= 3 && (
        <Card
          title={`校验预览：${preview.label}（共 ${preview.total} 行，通过 ${preview.valid}，不通过 ${preview.invalid}）`}
          style={{ marginBottom: 16 }}
          extra={
            <Button type="primary" danger disabled={preview.valid === 0 || committing} onClick={handleCommit} loading={committing}>
              确认导入
            </Button>
          }
        >
          {preview.errors.length > 0 && (
            <Alert type="error" message={preview.errors.join("；")} style={{ marginBottom: 12 }} />
          )}
          <Table
            size="small"
            rowKey="line"
            columns={previewColumns}
            dataSource={preview.rows}
            pagination={{ pageSize: 20 }}
          />
          {preview.truncated && <p style={{ color: "#999" }}>仅显示前 200 行。</p>}
        </Card>
      )}

      {receipt && (
        <Alert
          type="success"
          style={{ marginBottom: 16 }}
          message={`导入完成：新增 ${receipt.inserted} 条，更新 ${receipt.updated} 条，跳过 ${receipt.skipped.length} 条`}
          description={`批次号 ${receipt.batch_id}，已写入业务事件 ${receipt.event_id}。`}
        />
      )}

      {step >= 4 && (
        <Card title={`已导入记录：${selected?.label ?? ""}`} extra={<Button onClick={loadRecords}>刷新</Button>}>
          {records.length === 0 && !recordsLoading ? (
            <Empty description="暂无记录" />
          ) : (
            <Table
              size="small"
              rowKey={(r: RecordRow) => `${r.kind}:${r.code}`}
              columns={recordColumns}
              dataSource={records}
              loading={recordsLoading}
              pagination={{ pageSize: 20 }}
            />
          )}
        </Card>
      )}
    </div>
  );
}
