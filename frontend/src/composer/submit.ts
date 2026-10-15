import { api } from "../api";

/**
 * Shared composer submit (ADR-2026-10-15 (iii)). Both the workbench and
 * mail pages assemble their question the same way — question + the
 * submitting page's realtime context — and run the same
 * createTaskFromText → runTask chain. Page-specific work stays in the
 * pages: mail keeps its stage binding / mailCompose gate / mail entities,
 * Home keeps its clarification feedback / skill-param handling. The
 * `shouldRun` gate is where a page decides, after recognition, whether the
 * run proceeds (and shows its own notice/error when it does not).
 */

export function assembleComposerText(question: string, contextBuilder?: () => string): string {
  const q = String(question || "").trim();
  if (!q || !contextBuilder) return q;
  const context = String(contextBuilder() || "").trim();
  return context ? `${q}\n\n${context}` : q;
}

export type ComposerFromTextResult = {
  recognized: Awaited<ReturnType<typeof api.createTaskFromText>>;
  created: Awaited<ReturnType<typeof api.createTaskFromText>>["task"] | undefined;
  run: Awaited<ReturnType<typeof api.runTask>> | undefined;
};

export async function submitFromText(args: {
  text: string;
  createBody: Record<string, unknown>;
  runBody?: Record<string, unknown>;
  shouldRun?: (recognized: Awaited<ReturnType<typeof api.createTaskFromText>>) => boolean;
}): Promise<ComposerFromTextResult> {
  const recognized = await api.createTaskFromText({ text: args.text, ...args.createBody });
  const created = recognized.task;
  const proceed = args.shouldRun ? args.shouldRun(recognized) : Boolean(created?.id);
  if (!proceed || !created?.id) return { recognized, created, run: undefined };
  const run = await api.runTask(created.id, args.runBody ?? {});
  return { recognized, created, run };
}
