import type { ReactNode } from "react";
import type { SafeResultValue } from "./ResultRendererRegistry";

export type ResultStatus = "idle" | "ready" | "running" | "completed" | "partial" | "failed" | "stale";
export type ResultFreshness = "current" | "historical" | "stale" | "unknown";

export type ResultRailViewModel = {
  skillId?: string;
  resultType?: string;
  status: ResultStatus;
  version?: string;
  sourceLabel?: string;
  sourceVersion?: string;
  updatedAt?: string;
  freshness: ResultFreshness;
  currentResult?: ReactNode;
  resultValue?: SafeResultValue;
  history?: ReactNode;
  memory?: ReactNode;
  recommendations?: TaskRecommendationView[];
  registeredActions?: RegisteredActionView[];
  onAdoptRecommendation?: (recommendation: TaskRecommendationView) => void;
  onRegisteredAction?: (action: RegisteredActionView) => void;
  suggestions?: ReactNode;
  actions?: ReactNode;
};

/** Host-facing action view. UI must consume allowed/enabled state as provided. */
export type RegisteredActionView = {
  action_id: string;
  label: string;
  risk_level: "L1" | "L2" | "L3";
  state: "ready" | "blocked" | "awaiting_selection" | "awaiting_approval" | "completed";
  allowed: boolean;
  enabled: boolean;
  /** Host-issued ready/action snapshot version; changes whenever confirmed inputs change. */
  confirmation_version: string | null;
  disabled_reason?: string;
  selection_required: boolean;
  selection_ready: boolean;
  confirmation_required: boolean;
  approval_state: "not_required" | "required" | "pending" | "approved" | "rejected";
  receipt_id: string | null;
};

export type TaskRecommendationView = {
  id: string;
  title: string;
  reason?: string;
  status: "candidate" | "adopted" | "dismissed";
  intent?: string;
  handle?: string;
};
