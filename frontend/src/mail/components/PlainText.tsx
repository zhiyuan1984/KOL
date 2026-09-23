import { decodeHtmlEntities } from "../text";

/**
 * Plain rendering for mailbox memory text (digests, bodies, translations).
 * These are operator-facing paragraphs, not markdown documents — routing them
 * through the markdown pipeline pulled a 158 kB chunk onto the mail landing.
 */
export function PlainText({ text }: { text: string }) {
  const paragraphs = decodeHtmlEntities(String(text || ""))
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return (
    <>
      {paragraphs.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </>
  );
}
