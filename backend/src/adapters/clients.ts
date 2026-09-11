import { clawApiKey, clawBaseUrl, clawMode, starryBaseUrl, starryMode } from "../config.js";
import * as mockClaw from "./claw.js";
import * as mockStarry from "./starry.js";
import type { Json, StageTransitionInput } from "../types.js";

export const starry = {
  get mode() {
    return starryMode();
  },
  get base() {
    return starryBaseUrl();
  },
  cooperationStageOptions(): Json[] {
    return mockStarry.stageOptions();
  },
  dictionaryOptions(parentKey: string): Json[] {
    return mockStarry.dictionaryOptions(parentKey);
  },
  confirmStage(lifecycleId: string, stageCode: string, actor = "host", transition?: StageTransitionInput): Json {
    return mockStarry.confirmStage(lifecycleId, { stage_code: stageCode, actor, transition });
  },
  sendConversation(conversationId: string, payload: Json): Json {
    return mockStarry.sendConversation(conversationId, payload);
  },
  translateZh(payload: Json): Json {
    return mockStarry.translateZh(payload);
  },
};

export const claw = {
  get mode() {
    return clawMode();
  },
  get base() {
    return clawBaseUrl();
  },
  get headers() {
    return { "X-API-Key": clawApiKey() };
  },
  health(): Json {
    return mockClaw.health();
  },
  listCreators(): Json[] {
    return mockClaw.listCreators();
  },
  getCreator(cid: string): Json | null {
    return mockClaw.getCreator(cid);
  },
  outreachScript(cid: string): Json {
    return mockClaw.outreachScript(cid);
  },
  analysisCreators(cid?: string | null): Json {
    return mockClaw.analysis(cid);
  },
  dailyTasks(): Json {
    return mockClaw.dailyTasks();
  },
  campaigns(): Json[] {
    return mockClaw.campaigns();
  },
  budgetReport(): Json {
    return mockClaw.budgetReport();
  },
  ingestMediacrawler(body: Json): Json {
    return mockClaw.ingestMediacrawler(body);
  },
};
