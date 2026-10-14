import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyReviewDefinition, type ReviewCommand } from "../../shared/review.js";
import { ReviewService, type ReviewContext } from "../src/approval/review-service.js";
import { postgresDb, type PgRepository } from "../src/postgres/access.js";
import { presentationOverlaySnapshot, readPresentationOverlays, savePresentationOverlay } from "../src/host/skill-presentation.js";
import { freshTestDatabase } from "./support/pg.js";

let db: PgRepository;
const people = [
    { id: "admin", name: "管理员", managerIds: ["reviewer"] },
    { id: "employee", name: "员工", managerIds: ["reviewer"] },
    { id: "reviewer", name: "评审人", managerIds: [] },
];
const context = (actor: string): ReviewContext => ({
    tenant: "company",
    actor,
    admin: actor === "admin",
    people,
});
const service = (actor: string, now = "2026-10-14T00:00:00.000Z") => new ReviewService(db, context(actor), now);

beforeEach(async () => {
    await freshTestDatabase();
    db = postgresDb();
});
afterEach(async () => await db.close());

describe("knowledge-skills-review 原生 PostgreSQL 边界", () => {
    it("在没有调用方事务时仍以一个事务提交附件、确认和同幂等键的正式评审", async () => {
        const admin = service("admin");
        const attachment = await service("employee").uploadAttachment("材料.txt", Buffer.from("immutable bytes"));
        expect((await db.one("SELECT id FROM review_attachments WHERE tenant=$1 AND id=$2", "company", attachment.id))?.id).toBe(attachment.id);

        const template = await admin.saveTemplate(undefined, undefined, emptyReviewDefinition());
        const publish: ReviewCommand = { action: "publish", templateId: template.id, expectedVersion: 1 };
        const publicationConfirmation = await admin.prepare(publish);
        await admin.execute(publish, publicationConfirmation.confirmationId, "native-publish-key");

        const command: ReviewCommand = {
            action: "submit",
            templateId: template.id,
            templateVersion: 1,
            title: "原生事务申请",
            values: {},
        };
        const employee = service("employee");
        const confirmation = await employee.prepare(command);
        const key = "native-submit-idempotency";
        const [first, duplicate] = await Promise.all([
            employee.execute(command, confirmation.confirmationId, key),
            employee.execute(command, confirmation.confirmationId, key),
        ]);
        expect(duplicate).toEqual(first);
        expect((await db.many("SELECT receipt FROM review_commands WHERE tenant=$1 AND actor=$2 AND idempotency_key=$3", "company", "employee", key))).toHaveLength(1);
        expect((await db.many("SELECT id FROM review_instances WHERE tenant=$1 AND id=$2", "company", first.resourceId))).toHaveLength(1);
        expect((await db.many("SELECT user_id FROM review_participants WHERE tenant=$1 AND instance_id=$2 ORDER BY user_id", "company", first.resourceId)).map(row => row.user_id)).toEqual(["employee", "reviewer"]);
    });

    it("发布展示覆盖后只从已发布的内存快照读取，不需要同步数据库读取", async () => {
        await savePresentationOverlay("email_compose", { badge: "原生快照" });
        expect(presentationOverlaySnapshot().get("email_compose")?.badge).toBe("原生快照");
        await db.execute("DELETE FROM skill_presentation_overlays WHERE skill_id=$1", "email_compose");
        // Registry 的同步读取契约只允许使用已发布 snapshot；数据库变化不会在读取时触发 I/O。
        expect(presentationOverlaySnapshot().get("email_compose")?.badge).toBe("原生快照");
        await readPresentationOverlays();
        expect(presentationOverlaySnapshot().has("email_compose")).toBe(false);
    });
});
