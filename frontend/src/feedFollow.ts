/**
 * 中栏 feed 的「有新内容」计数（DESIGN §10.2）：用户离开底部时记下读数，
 * 之后新到的消息按条数计；流式重写同一条消息时只算一次「有新内容」，不谎报条数。
 */

export type FeedReadMark = { items: number; height: number };

export type FeedUnread = { count: number; grew: boolean };

export const NO_UNREAD: FeedUnread = { count: 0, grew: false };

export function newContentSince(mark: FeedReadMark | null, items: number, height: number): FeedUnread {
  if (!mark) return NO_UNREAD;
  const count = Math.max(0, items - mark.items);
  return { count, grew: count === 0 && height > mark.height + 1 };
}

/** 提示文案：条数可信时给条数，只涨高度时只说「有新内容」。 */
export function newContentLabel(unread: FeedUnread): string {
  if (unread.count > 0) return `有 ${unread.count} 条新内容`;
  return unread.grew ? "有新内容" : "";
}
