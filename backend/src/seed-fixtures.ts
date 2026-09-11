/**
 * Test / e2e workbench rows. Product seed never plants these.
 */
import { BRAND_MAILBOXES } from "./config.js";
import { getConn } from "./db.js";
import { taskDefinition } from "./tasks/registry.js";

function dayAt(offset: number): string {
  const day = new Date();
  day.setHours(12, 0, 0, 0);
  day.setDate(day.getDate() + offset);
  return day.toISOString();
}

export function seedWorkbenchFixtures(): void {
  const conn = getConn();
  const collabs = [
    {
      id: "col_xiaomei",
      handle: "小美妆日记",
      display_name: "小美妆日记",
      brand: "LT",
      platform: "小红书",
      followers: "82万",
      email: "xiaomei.beauty@example.com",
      mailbox_from: BRAND_MAILBOXES.LT,
      lifecycle_id: "lc_xiaomei",
      conversation_id: "conv_xiaomei",
      stage_code: "INITIAL_CONTACT",
      days_in_stage: 12,
      notes: "首封已读未回，适合跟进",
      overdue: 1,
      stage_version: 0,
      recipient_name: "小美",
      phone: "",
      address_line: "杭州市西湖区",
      country: "CN",
      postal: "",
      sku: "LT-MINI-12",
      qty: "1",
      locked: 0,
    },
    {
      id: "col_laozhang",
      handle: "数码老张",
      display_name: "数码老张",
      brand: "LT",
      platform: "B站",
      followers: "46万",
      email: "zhang.digital@example.com",
      mailbox_from: BRAND_MAILBOXES.LT,
      lifecycle_id: "lc_laozhang",
      conversation_id: "conv_laozhang",
      stage_code: "QUOTE_PENDING",
      days_in_stage: 4,
      notes: "报价草案 $680，待确认",
      overdue: 0,
      stage_version: 0,
      recipient_name: "张伟",
      phone: "13800001111",
      address_line: "深圳市南山区科技园路 1 号",
      country: "CN",
      postal: "518000",
      sku: "LT-100AH",
      qty: "2",
      locked: 0,
    },
    {
      id: "col_mum",
      handle: "母婴小课",
      display_name: "母婴小课",
      brand: "RO",
      platform: "抖音",
      followers: "31万",
      email: "mum.course@example.com",
      mailbox_from: BRAND_MAILBOXES.RO,
      lifecycle_id: "lc_mum",
      conversation_id: "conv_mum",
      stage_code: "CONTENT_PLANNING",
      days_in_stage: 6,
      notes: "大纲未回，可催更",
      overdue: 1,
      stage_version: 0,
      recipient_name: "陈敏",
      phone: "13900002222",
      address_line: "成都市高新区天府大道 88 号",
      country: "CN",
      postal: "610000",
      sku: "RO-CAMP-KIT",
      qty: "1",
      locked: 0,
    },
    {
      id: "col_trip",
      handle: "旅行电源菌",
      display_name: "旅行电源菌",
      brand: "PQ",
      platform: "YouTube",
      followers: "9万",
      email: "trip.power@example.com",
      mailbox_from: BRAND_MAILBOXES.PQ,
      lifecycle_id: "lc_trip",
      conversation_id: "conv_trip",
      stage_code: "DISPUTED",
      days_in_stage: 20,
      notes: "样品丢失争议",
      overdue: 1,
      stage_version: 0,
      recipient_name: "",
      phone: "",
      address_line: "",
      country: "",
      postal: "",
      sku: "",
      qty: "",
      locked: 0,
    },
  ];
  const insCol = conn.prepare(`
        INSERT OR REPLACE INTO collaborations
        (id, handle, display_name, brand, platform, followers, email, mailbox_from,
         lifecycle_id, conversation_id, stage_code, days_in_stage, notes, overdue,
         stage_version, recipient_name, phone, address_line, country, postal, sku, qty, locked)
        VALUES (@id,@handle,@display_name,@brand,@platform,@followers,@email,@mailbox_from,
                @lifecycle_id,@conversation_id,@stage_code,@days_in_stage,@notes,@overdue,
                @stage_version,@recipient_name,@phone,@address_line,@country,@postal,@sku,@qty,@locked)
  `);
  for (const c of collabs) insCol.run(c);

  conn.prepare(
    `UPDATE collaborations SET owner_name='钟槿年', avg_views_10='1871', engagement_rate='0.037',
      audience_geo='美国', duplicate_checked=1, group_brand_overlap='未与RO/PQ合作' WHERE id='col_xiaomei'`,
  ).run();
  conn.prepare(
    `UPDATE collaborations SET owner_name='叶观旺', avg_views_10='11000', engagement_rate='0.0955',
      audience_geo='美国', duplicate_checked=1, group_brand_overlap='可接触RO' WHERE id='col_laozhang'`,
  ).run();
  conn.prepare(
    `UPDATE collaborations SET owner_name='陈冰冰', avg_views_10='6400', engagement_rate='0.052',
      audience_geo='中国', duplicate_checked=1, group_brand_overlap='RO主责' WHERE id='col_mum'`,
  ).run();
  conn.prepare(
    `UPDATE collaborations SET owner_name='黎玉燕', avg_views_10='2100', engagement_rate='0.028',
      audience_geo='德国', duplicate_checked=0, group_brand_overlap='PQ主责' WHERE id='col_trip'`,
  ).run();

  const creators = [
    {
      id: "cr_xiaomei",
      handle: "小美妆日记",
      name: "小美妆日记",
      platform: "xiaohongshu",
      followers: 820000,
      score: 8.6,
      status: "in_pipeline",
      outreach_script: "Hi, this is LiTime collab team — following up on the portable power station kit.",
      payload: JSON.stringify({ niche: "beauty", brand_fit: "LT", email: "xiaomei.beauty@example.com" }),
    },
    {
      id: "cr_laozhang",
      handle: "数码老张",
      name: "数码老张",
      platform: "bilibili",
      followers: 460000,
      score: 9.1,
      status: "in_pipeline",
      outreach_script: "Hi Zhang, sharing the LiTime 100Ah mini quote we discussed.",
      payload: JSON.stringify({ niche: "consumer-electronics", brand_fit: "LT", email: "laozhang.tech@example.com" }),
    },
    {
      id: "cr_mum",
      handle: "母婴小课",
      name: "母婴小课",
      platform: "douyin",
      followers: 310000,
      score: 7.9,
      status: "in_pipeline",
      outreach_script: "Hi, checking in on the family camping power outline.",
      payload: JSON.stringify({ niche: "parenting", brand_fit: "RO", email: "mum.class@example.com" }),
    },
    {
      id: "cr_outdoor",
      handle: "户外充电君",
      name: "户外充电君",
      platform: "youtube",
      followers: 120000,
      score: 8.2,
      status: "discovered",
      outreach_script: "Hi, LiTime outdoor desk would love to send a Mini 12V kit for a weekend van test.",
      payload: JSON.stringify({ niche: "vanlife", brand_fit: "LT", unbound: true, email: "vanlife.kit@example.com" }),
    },
  ];
  const insCr = conn.prepare(`
        INSERT OR REPLACE INTO claw_creators
        (id, handle, name, platform, followers, score, status, outreach_script, payload)
        VALUES (@id,@handle,@name,@platform,@followers,@score,@status,@outreach_script,@payload)
  `);
  for (const c of creators) insCr.run(c);

  const candidates = JSON.stringify([
    { id: "col_xiaomei", handle: "小美妆日记", score: 0.42 },
    { id: "cr_outdoor", handle: "户外充电君", score: 0.61, unbound: true },
  ]);
  conn
    .prepare(
      `INSERT OR REPLACE INTO inbound
      (id, from_addr, from_name, subject, snippet, summary, bound, deferred, collaboration_id, session_id, confidence, candidates, ts)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      "inb_unbound_1",
      "vanlife.kit@example.com",
      "Van Kit",
      "Re: weekend van power",
      "Hey LiTime, can you ship the Mini to our garage in Portland?",
      "询问 Mini 12V 寄往 Portland 车库，未绑定生命周期。",
      0,
      0,
      null,
      null,
      "low",
      candidates,
      "2026-08-28T09:00:00+00:00",
    );

  const owner = "usr_sriphy";
  const items: {
    id: string;
    type: string;
    title: string;
    status: string;
    source: string;
    priority: string;
    collaboration_id: string | null;
    handle: string;
    due_at: string | null;
    promoted_at: string | null;
    events: { id: string; type: string; label: string; status: string; summary: string; time: string }[];
  }[] = [
    {
      id: "tsk_home_xiaomei_mail",
      type: "stage_mail",
      title: "给@小美妆日记 写跟进邮件",
      status: "completed",
      source: "manual",
      priority: "high",
      collaboration_id: "col_xiaomei",
      handle: "小美妆日记",
      due_at: null,
      promoted_at: null,
      events: [
        { id: "tev_home_xm_1", type: "task.created", label: "写阶段跟进邮件", status: "pending", summary: "任务已创建", time: "2026-08-28T09:00:00+00:00" },
        { id: "tev_home_xm_2", type: "task.run", label: "生成跟进信", status: "running", summary: "已按品牌锁定发件箱", time: "2026-08-28T09:01:00+00:00" },
        { id: "tev_home_xm_3", type: "task.completed", label: "写阶段跟进邮件", status: "completed", summary: "英文原稿已落草稿，阶段未变", time: "2026-08-28T09:02:00+00:00" },
      ],
    },
    {
      id: "tsk_home_xiaomei_lost",
      type: "lost_contact",
      title: "给@小美妆日记 失联跟进",
      status: "pending",
      source: "ai",
      priority: "high",
      collaboration_id: "col_xiaomei",
      handle: "小美妆日记",
      due_at: null,
      promoted_at: null,
      events: [
        { id: "tev_home_xm_4", type: "task.created", label: "失联跟进", status: "pending", summary: "停留 12 天未回，建议跟进", time: "2026-09-01T10:00:00+00:00" },
      ],
    },
    {
      id: "tsk_home_laozhang_quote",
      type: "quote_confirm",
      title: "给@数码老张 写报价确认邮件",
      status: "waiting",
      source: "manual",
      priority: "high",
      collaboration_id: "col_laozhang",
      handle: "数码老张",
      due_at: dayAt(0),
      promoted_at: null,
      events: [
        { id: "tev_home_lz_1", type: "task.created", label: "写报价信", status: "pending", summary: "任务已创建", time: "2026-08-30T11:00:00+00:00" },
        { id: "tev_home_lz_2", type: "task.run", label: "写报价信", status: "waiting", summary: "金额 $680，待确认发送", time: "2026-08-30T11:02:00+00:00" },
      ],
    },
    {
      id: "tsk_home_mum_nudge",
      type: "content_nudge",
      title: "给@母婴小课 催大纲",
      status: "completed",
      source: "manual",
      priority: "normal",
      collaboration_id: "col_mum",
      handle: "母婴小课",
      due_at: null,
      promoted_at: null,
      events: [
        { id: "tev_home_mum_1", type: "task.created", label: "催大纲", status: "pending", summary: "任务已创建", time: "2026-08-29T08:00:00+00:00" },
        { id: "tev_home_mum_2", type: "task.completed", label: "催大纲", status: "completed", summary: "TESTING/策划阶段可催更，已出信", time: "2026-08-29T08:03:00+00:00" },
      ],
    },
    {
      id: "tsk_home_trip_stage",
      type: "confirm_stage",
      title: "记状态 @旅行电源菌",
      status: "failed",
      source: "ai",
      priority: "high",
      collaboration_id: "col_trip",
      handle: "旅行电源菌",
      due_at: dayAt(-2),
      promoted_at: "2026-08-27T14:05:00+00:00",
      events: [
        { id: "tev_home_trip_1", type: "task.created", label: "记状态", status: "pending", summary: "任务已创建", time: "2026-08-27T14:00:00+00:00" },
        { id: "tev_home_trip_2", type: "task.failed", label: "记状态", status: "failed", summary: "样品丢失争议，主流程已离开时间线", time: "2026-08-27T14:04:00+00:00" },
      ],
    },
    {
      id: "tsk_home_outdoor_profile",
      type: "creator_profile",
      title: "达人画像 户外充电君",
      status: "pending",
      source: "ai",
      priority: "normal",
      collaboration_id: null,
      handle: "户外充电君",
      due_at: null,
      promoted_at: null,
      events: [
        { id: "tev_home_out_1", type: "task.created", label: "达人画像", status: "pending", summary: "未建联红人，待补画像", time: "2026-08-28T09:05:00+00:00" },
      ],
    },
  ];
  const insItem = conn.prepare(
    `INSERT OR REPLACE INTO work_items
     (id,owner_user_id,task_type,title,source,status,priority,skill,profile,project_id,
      collaboration_id,session_id,due_at,promoted_at,dismissed_at,input,entities,data_version,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  const insEvent = conn.prepare(
    `INSERT OR REPLACE INTO task_events
     (id,work_item_id,run_id,sequence,event_type,label,status,safe_summary,time,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  );
  for (const item of items) {
    const profile = taskDefinition(item.type)?.profile || "lead";
    insItem.run(
      item.id, owner, item.type, item.title, item.source, item.status, item.priority, item.type,
      profile, item.collaboration_id, item.collaboration_id, null, item.due_at, item.promoted_at, null,
      JSON.stringify({ prompt: item.title, collaboration_id: item.collaboration_id }),
      JSON.stringify({ handle: item.handle }), 1,
      item.events[0]?.time || "2026-08-28T09:00:00+00:00",
      item.events[item.events.length - 1]?.time || "2026-08-28T09:00:00+00:00",
    );
    conn.prepare("DELETE FROM task_events WHERE work_item_id=?").run(item.id);
    item.events.forEach((event, index) => {
      insEvent.run(event.id, item.id, null, index + 1, event.type, event.label, event.status, event.summary, event.time, event.time);
    });
  }
}
