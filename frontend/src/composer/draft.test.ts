// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  applyDraft,
  clearDraft,
  clearSessionDraft,
  draftKey,
  lastWorkspaceTarget,
  mergeAssetDraft,
  readDraft,
  readSessionWorkDraft,
  readWorkspaceDraft,
  saveSessionWorkDraft,
  saveWorkspaceDraft,
  scopeEquals,
  storeSessionDraft,
  takeDraft,
  takeSessionDraft,
  validWorkspaceTarget,
  writeDraft,
} from "./draft";
import { COMPOSER_DRAFT_EVENT, COMPOSER_DRAFT_STASH, clientEntryFor } from "./types";

beforeEach(() => sessionStorage.clear());

describe("unified scoped drafts", () => {
  it("stores the chip/scope shape without opening a page", () => {
    const stored = writeDraft({ page: "home" }, {
      text: "给@小美妆日记 写跟进",
      intent: "mail_reply",
      chips: [{ kind: "skill", id: "email_compose", label: "写跟进邮件", write: true }],
      object_refs: [{ kind: "kol", id: "xiaomei", label: "小美妆日记" }],
      client_entry: "compose-send",
    });
    expect(readDraft({ page: "home" })?.intent).toBe("mail_reply");
    expect(readDraft({ page: "home" })?.chips?.[0]).toMatchObject({ kind: "skill", id: "email_compose" });
    expect(takeDraft({ page: "home" })).toEqual(stored);
    expect(readDraft({ page: "home" })).toBeNull();
  });

  it("keeps the live mail key format and isolates mail from home", () => {
    expect(draftKey({ page: "mail", actor: "alice", mailbox: "Brand@X.com", conversationId: "c1" }))
      .toBe("mail-draft:v2:alice:brand%40x.com:c1");
    writeDraft({ page: "home" }, { text: "工作台草稿" });
    writeDraft({ page: "mail", actor: "alice", mailbox: "Brand@X.com", conversationId: "c1" }, { text: "邮件草稿" });
    expect(readDraft({ page: "home" })?.text).toBe("工作台草稿");
    expect(readDraft({ page: "mail", actor: "alice", mailbox: "Brand@X.com", conversationId: "c1" })?.text).toBe("邮件草稿");
    expect(readDraft({ page: "mail", actor: "alice", mailbox: "Brand@X.com", conversationId: "other" })).toBeNull();
    clearDraft({ page: "mail", actor: "alice", mailbox: "Brand@X.com", conversationId: "c1" });
    expect(readDraft({ page: "home" })?.text).toBe("工作台草稿");
  });

  it("keeps the live session key format", () => {
    expect(draftKey({ page: "session", actor: "alice", sessionId: "ses-a" })).toBe("workspace:asset-draft:alice:ses-a");
    writeDraft({ page: "session", actor: "alice", sessionId: "ses-a" }, { text: "会话草稿" });
    expect(readDraft({ page: "session", actor: "alice", sessionId: "ses-a" })?.text).toBe("会话草稿");
    expect(readDraft({ page: "session", actor: "bob", sessionId: "ses-a" })).toBeNull();
  });

  it("compares scopes without the actor", () => {
    expect(scopeEquals({ page: "mail", actor: "alice", mailbox: "m", conversationId: "c" }, { page: "mail", actor: "bob", mailbox: "m", conversationId: "c" })).toBe(true);
    expect(scopeEquals({ page: "mail", mailbox: "m", conversationId: "c" }, { page: "home" })).toBe(false);
  });

  it("broadcasts the scope with the draft", () => {
    const seen: unknown[] = [];
    const onDraft = (event: Event) => seen.push((event as CustomEvent).detail);
    window.addEventListener(COMPOSER_DRAFT_EVENT, onDraft);
    try {
      applyDraft({ page: "home" }, { text: "广播草稿" });
    } finally {
      window.removeEventListener(COMPOSER_DRAFT_EVENT, onDraft);
    }
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ scope: { page: "home" }, draft: { text: "广播草稿" } });
  });

  it("maps entry intent to client_entry", () => {
    expect(clientEntryFor("free")).toBe("compose-send");
    expect(clientEntryFor("discover")).toBe("start-crawl");
    expect(clientEntryFor("analyze_followed")).toBe("enqueue-analyze");
    expect(clientEntryFor("mail_reply")).toBe("compose-send");
  });

  it("keeps the home stash key for the home scope", () => {
    writeDraft({ page: "home" }, { text: "home" });
    expect(sessionStorage.getItem(COMPOSER_DRAFT_STASH)).toContain("home");
  });
});

describe("legacy session drafts", () => {
  it("consumes a template draft once, surviving a StrictMode remount", () => {
    storeSessionDraft("ses-1", { text: "模板草稿", intent: "mail_reply", title: "回复" });
    const first = takeSessionDraft("ses-1");
    expect(first).toEqual({ text: "模板草稿", intent: "mail_reply", title: "回复" });
    expect(takeSessionDraft("ses-1")).toEqual(first);
    clearSessionDraft("ses-1");
    expect(takeSessionDraft("ses-1")).toBeNull();
  });

  it("round-trips session work drafts and clears on empty text", () => {
    expect(saveSessionWorkDraft("alice", "ses-1", { text: "进行中", knowledge_id: "kb-1" })).toBe(true);
    expect(readSessionWorkDraft("alice", "ses-1")).toEqual({ text: "进行中", knowledge_id: "kb-1" });
    expect(readSessionWorkDraft("bob", "ses-1")).toBeNull();
    expect(saveSessionWorkDraft("alice", "ses-1", { text: "" })).toBe(true);
    expect(readSessionWorkDraft("alice", "ses-1")).toBeNull();
    expect(saveSessionWorkDraft("", "ses-1", { text: "x" })).toBe(false);
  });
});

describe("catalogue draft handoff", () => {
  it("adds references without replacing text, attachments, objects, model or Agent", () => {
    const prior = { text:"已经填写的需求", attachments:[{path:"/file/a",name:"资料"}], scope:{expert_id:"agent:chosen"},model_tier:"quality",
      object_refs:[{kind:"kol",id:"object-1"}],chips:[{kind:"kb" as const,id:"old",label:"原资料",version:2}] };
    const merged = mergeAssetDraft(prior,{text:"模板正文",chips:[{kind:"skill",id:"chosen",label:"技能"}]});
    expect(merged.text).toBe(prior.text); expect(merged.attachments).toEqual(prior.attachments);
    expect(merged.object_refs).toEqual(prior.object_refs); expect(merged.scope?.expert_id).toBe("agent:chosen");
    expect(merged.model_tier).toBe("quality"); expect(merged.chips).toHaveLength(2);
    expect(mergeAssetDraft(merged,{text:"替换",chips:[{kind:"kb",id:"old",label:"原资料",version:3}]}).chips).toHaveLength(2);
  });
  it("isolates employees and sessions and preserves the original session address", () => {
    const target={sessionId:"ses-a",path:"/s/ses-a",title:"任务"};
    saveWorkspaceDraft("alice",target,{text:"草稿"});
    expect(readWorkspaceDraft("bob","ses-a")).toBeNull(); expect(readWorkspaceDraft("alice","ses-b")).toBeNull();
    expect(lastWorkspaceTarget("alice")).toEqual(target); expect(readWorkspaceDraft("alice","ses-a")?.draft.text).toBe("草稿");
    const discovery={sessionId:"ses-a",path:"/?tab=discovery&session_id=ses-a",title:"发现"};
    expect(validWorkspaceTarget(discovery)).toBe(true);
    saveWorkspaceDraft("alice",discovery,{text:"发现草稿"}); expect(lastWorkspaceTarget("alice")?.path).toBe(discovery.path);
  });
  it("rejects cross-origin, unrelated and mismatched return addresses", () => {
    for (const path of ["https://attacker.example/s/ses-a","/tasks","/s/ses-b","/?session_id=ses-b","/?tab=pool&session_id=ses-a"]) {
      const target={sessionId:"ses-a",path,title:"任务"};
      expect(validWorkspaceTarget(target)).toBe(false); saveWorkspaceDraft("alice",target,{text:"私有"});
    }
    expect(lastWorkspaceTarget("alice")).toBeNull();
  });
  it("does not silently exceed the existing skill-selection limit", () => {
    const prior={text:"原草稿",chips:["a","b","c"].map(id=>({kind:"skill" as const,id,label:id}))};
    expect(()=>mergeAssetDraft(prior,{text:"新增",chips:[{kind:"skill",id:"d",label:"d"}]})).toThrow("三项技能");
    expect(mergeAssetDraft(prior,{text:"新增",chips:[{kind:"skill",id:"a",label:"a"}]}).chips).toHaveLength(3);
  });
  it("rejects broken local envelopes without crashing a session", () => {
    for (const value of ["{}","null","[]",'"text"','{"target":{"sessionId":"ses-a","path":"/tasks"},"draft":{"text":"wrong route"}}']) {
      sessionStorage.setItem("workspace:asset-draft:alice:ses-a",value);
      expect(readWorkspaceDraft("alice","ses-a")).toBeNull();
    }
  });
});
