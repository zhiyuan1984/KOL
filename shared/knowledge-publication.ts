import type { ReviewDefinition } from "./review.js";
export type KnowledgePublication = {
  tenant: string;
  instanceId: string;
  documentId: string;
  title: string;
  filename: string;
  fingerprint: string;
  releaseNote: string;
  status: "waiting" | "published" | "rejected" | "withdrawn" | "failed";
  reviewStatus: string;
  blockedReason?: string;
  error?: string;
  receipt?: { id: string; status: string; at: string };
  job?: { id: string; status: string; error?: string };
  createdAt: string;
  updatedAt: string;
};
export type KnowledgePublicationOptions = {
  legacy?: { updatedAt: string };
  tenant: string;
  templates: { id: string; version: number; definition: ReviewDefinition }[];
  publication: KnowledgePublication | null;
  intake: { allowed: boolean; reason: string };
};
export type KnowledgePublicationCommand = {
  templateId: string;
  templateVersion: number;
  values: Record<string, unknown>;
  releaseNote: string;
};
