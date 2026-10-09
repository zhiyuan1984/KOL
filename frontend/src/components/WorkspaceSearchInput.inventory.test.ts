// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const inventory: Array<[string, string]> = [
  ["admin/connector/ConnectorHub.tsx", "data-connector-search"],
  ["admin/connector/ConnectorHub.tsx", "data-connector-browse-search"],
  ["admin/connector/ConnectorToolsCard.tsx", "data-connector-drawer-search"],
  ["admin/employees/EmployeeDirectoryV2.tsx", "data-employee-search"],
  ["admin/employees/EmployeeDirectoryV2.tsx", 'aria-label="搜索组织内人员"'],
  ["admin/knowledge/BaseView.tsx", 'data-admin-kb-filter="query"'],
  ["admin/knowledge/CatalogView.tsx", "data-admin-kb-catalog-search"],
  ["admin/knowledge/KnowledgeBrowseFilters.tsx", "data-kbv-search"],
  ["admin/knowledge/KnowledgeFilters.tsx", "data-kbv-search"],
  ["components/AgentTaskList.tsx", 'placeholder={mailMode ? "搜索邮件" : "搜索任务"}'],
  ["components/ChatBlocks.tsx", 'placeholder="搜索达人"'],
  ["composer/PlusMenu.tsx", "data-composer-menu-search"],
  ["home/FollowedPane.tsx", "data-followed-object-search"],
  ["pages/Admin.tsx", 'placeholder="搜索主键或名称"'],
  ["pages/AdminAgents.tsx", 'aria-label="搜索 Agent"'],
  ["pages/AdminExams.tsx", 'placeholder="搜索已发布知识…"'],
  ["pages/AdminWorkOrders.tsx", 'placeholder="名称或编码"'],
  ["pages/AdminWorkReport.tsx", 'aria-label="搜索成员"'],
  ["pages/Cooperations.tsx", 'aria-label="搜索合作项目"'],
  ["pages/Cooperations.tsx", 'placeholder="搜索账号名"'],
  ["pages/Cron.tsx", 'id="cron-search"'],
  ["pages/Knowledge.tsx", "data-kb-search"],
  ["pages/Leads.tsx", 'aria-label="搜索线索"'],
  ["pages/Mail.tsx", "data-mail-search"],
  ["pages/Reviews.tsx", 'aria-label="搜索标题或流程名称"'],
  ["pages/SimplePages.tsx", "data-hub-search"],
  ["pages/SkillCatalog.tsx", 'aria-label="搜索技能 / SOP / 场景"'],
  ["pages/SkillHub.tsx", "data-hub-search"],
  ["pages/SkillLifecycle.tsx", 'aria-label="搜索技能"'],
  ["pages/SkillLifecycleV2.tsx", 'aria-label="搜索技能"'],
  ["pages/Tasks.tsx", 'className="task-filter-search"'],
  ["reviews/ReviewTemplateBrowser.tsx", 'aria-label="搜索流程"'],
];

function tagsContaining(source: string, name: "input" | "WorkspaceSearchInput", marker: string) {
  const tags = source.match(new RegExp(`<${name}\\b(?:(?!/>).)*?/>`, "gs")) || [];
  return tags.filter((tag) => tag.includes(marker));
}

describe("WorkspaceSearchInput migration inventory", () => {
  it("replaces every audited native search field while preserving its selector or accessible label", () => {
    for (const [relativePath, marker] of inventory) {
      const source = readFileSync(resolve(process.cwd(), "src", relativePath), "utf8");
      expect(tagsContaining(source, "input", marker), `${relativePath}: ${marker}`).toHaveLength(0);
      expect(tagsContaining(source, "WorkspaceSearchInput", marker), `${relativePath}: ${marker}`).toHaveLength(1);
    }
  });
});
