/** Pure API DTOs: safe for cross-surface typechecking without importing React hooks. */
export type MailLabel = { id: string; name: string; count: number };
export type MailLabelsSnapshot = {
  mailbox: string;
  labels: MailLabel[];
  assignments: { conversation_id: string; label_ids: string[] }[];
  selected_label_ids: string[];
  version: number;
};
export type MailLabelMutation = {
  box: string;
  conversation_id: string;
  mode: "add" | "remove";
  name?: string;
  label_id?: string;
  expected_version: number;
  confirm: true;
};
