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
  /** Legacy selector retained for non-AI clients; the mail UI must not hand-type it. */
  name?: string;
  label_id?: string;
  /** Opaque candidate adoption selector; only valid together for mode:"add". */
  candidate_receipt_id?: string;
  candidate_id?: string;
  expected_version: number;
  confirm: true;
};
