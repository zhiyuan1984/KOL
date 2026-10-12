/**
 * API-only DTOs for an explicit AI label recommendation.
 * Receiving a candidate never changes a label; adoption remains the existing
 * `mail.label` command with its confirmation and optimistic-version receipt.
 */
export type MailLabelSuggestionRequest = {
  box: string;
  conversation_id: string;
  /** Required only when the current employee can choose among multiple usable Agents. */
  agent_id?: string;
};

export type MailLabelSuggestion = {
  /** Opaque identity within this one server-issued receipt. */
  id: string;
  /** Existing private-label identity, or null for a new server-confirmable candidate. */
  label_id: string | null;
  /** Existing exact display name or a server-validated new Chinese label candidate. */
  name: string;
  /** Short model rationale; a suggestion, not an asserted mail fact or a save receipt. */
  reason: string;
  /** Hash of the bounded authorized mail snapshot used for this candidate. */
  source_fingerprint: string;
  mailbox: string;
  conversation_id: string;
};

export type MailLabelSuggestionStatus = "completed" | "no_mail_evidence";

export type MailLabelSuggestionResponse = {
  entry: "think";
  kind: "think";
  creates_session: false;
  creates_turn: true;
  calls_model: true;
  mailbox: string;
  conversation_id: string;
  /** Exact bounded authorized mail snapshot supplied to the one Codex turn. */
  body_fingerprint: string;
  source_fingerprint: string;
  /** `codex` is returned only after a real single Codex harness completion. */
  source: "codex" | "none";
  /** Resolved by the server after current Agent eligibility validation. */
  runtime_agent_id: string;
  /** Current contract maps to the existing published read-only mail-summary skill. */
  runtime_skill_id: "mail_summary";
  status: MailLabelSuggestionStatus;
  /** One-time opaque server receipt. It is null when no candidate exists. */
  receipt_id: string | null;
  /** Label dictionary/assignment version bound into receipt_id. */
  label_state_version: number;
  /** Labels already persisted before the think request; no write occurs here. */
  assigned_label_ids: string[];
  suggestions: MailLabelSuggestion[];
};
