import { AsyncLocalStorage } from "node:async_hooks";

/** Not a model/tool argument: only the checked Gateway owns this execution context. */
const authority = new AsyncLocalStorage<{ draftId: string; requestId: string }>();

export function withMailSendAuthority<T>(draftId: string, requestId: string, fn: () => T): T {
  return authority.run({ draftId, requestId }, fn);
}

export function assertMailSendAuthority(): void {
  if (!authority.getStore()) {
    throw new Error("mail_send_requires_gateway: 请在当前草稿结果中核对并确认发送，聊天文本不是发送许可。");
  }
}
