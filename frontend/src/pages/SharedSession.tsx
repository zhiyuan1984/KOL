import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, type EmailCard, type Message } from "../api";
import { ChatThread, emailMarkdown } from "../components/ChatBlocks";
import Markdown from "../components/Markdown";

export default function SharedSession() {
  const { token = "" } = useParams();
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api.sharedSession(token).then(setData).catch((e) => setError(e instanceof Error ? e.message : "分享链接无效"));
  }, [token]);
  const messages = Array.isArray(data?.messages) ? data.messages as Message[] : [];
  const draftMessage = [...messages].reverse().find((message) => message.kind === "email_card");
  const session = (data?.session && typeof data.session === "object" ? data.session : {}) as Record<string, unknown>;
  return (
    <main className="shared-page">
      <header><div className="page-kicker">只读分享</div><h1>{String(session.title || data?.title || "共享会话")}</h1><p className="muted">此页面不可编辑。内部中文、审批和私有数据默认不包含在分享中。</p></header>
      {error && <div className="error-card" role="alert"><strong>无法打开分享</strong>{error}</div>}
      {!error && !data && <p className="muted" role="status">正在加载…</p>}
      {messages.length > 0 && <ChatThread messages={messages} />}
      {draftMessage && <article className="artifact shared-artifact"><Markdown>{emailMarkdown(draftMessage.payload as unknown as EmailCard)}</Markdown></article>}
      {data && !messages.length && <p className="muted">这个分享中没有可公开的消息。</p>}
    </main>
  );
}
