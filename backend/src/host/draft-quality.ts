/** Reject model output that stuffed a missing-input prompt into the email itself. */
export function isMissingInputDraft(subject: string, body: string): boolean {
  const blob = `${subject}\n${body}`.toLowerCase();
  return /collaboration id required|please provide.{0,80}(handle|collaboration|creator)|creator handle or collaboration|please (specify|provide) .{0,40}(kol|creator)|请(提供|补充|指定|填写).{0,24}(红人|合作|collaboration)/i.test(blob);
}
