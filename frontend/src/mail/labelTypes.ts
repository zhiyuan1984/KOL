/** Pure API DTOs: safe for cross-surface typechecking without importing React hooks. */
export type MailLabel = { id: string; name: string; count: number };
export type MailLabelsSnapshot = {
  mailbox: string;
  labels: MailLabel[];
  /** 标签跟人走：指派键是对方邮箱 peer_email，同一对方的多会话共享同一组标签。 */
  assignments: { peer_email: string; label_ids: string[] }[];
  selected_label_ids: string[];
  version: number;
};
export type MailLabelMutation = {
  box: string;
  conversation_id: string;
  mode: "add" | "remove";
  /** 手工输入标签走 name（不存在则新建）；AI 候选走 candidate_receipt_id/candidate_id。 */
  name?: string;
  label_id?: string;
  /** Opaque candidate adoption selector; only valid together for mode:"add". */
  candidate_receipt_id?: string;
  candidate_id?: string;
  expected_version: number;
  confirm: true;
};
