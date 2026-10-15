export const REVIEW_INBOX_CHANGED_EVENT = "lingong:review-inbox-changed";

/** Refresh from the server; never decrement a count based on a UI click. */
export function refreshReviewInbox() {
  window.dispatchEvent(new Event(REVIEW_INBOX_CHANGED_EVENT));
}
