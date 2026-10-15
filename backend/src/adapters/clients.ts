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
  async confirmStage(lifecycleId: string, stageCode: string, actor = "host", transition?: StageTransitionInput): Promise<Awaited<Json>> {
    return (await mockStarry.confirmStage(lifecycleId, { stage_code: stageCode, actor, transition }));
  },
  async sendConversation(conversationId: string, payload: Json): Promise<Awaited<Json>> {
    return (await mockStarry.sendConversation(conversationId, payload));
  },
  async translateZh(payload: Json): Promise<Awaited<Json>> {
    return (await mockStarry.translateZh(payload));
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
  async listCreators(): Promise<Awaited<Json[]>> {
    return (await mockClaw.listCreators());
  },
  async getCreator(cid: string): Promise<Awaited<Json | null>> {
    return (await mockClaw.getCreator(cid));
  },
  async outreachScript(cid: string): Promise<Awaited<Json>> {
    return (await mockClaw.outreachScript(cid));
  },
  async analysisCreators(cid?: string | null): Promise<Awaited<Json>> {
    return (await mockClaw.analysis(cid));
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
  async ingestMediacrawler(body: Json): Promise<Awaited<Json>> {
    return (await mockClaw.ingestMediacrawler(body));
  },
};
