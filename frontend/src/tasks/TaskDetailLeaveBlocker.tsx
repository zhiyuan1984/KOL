import { useContext, useEffect, useRef, type MutableRefObject } from "react";
import { UNSAFE_DataRouterContext, useBlocker } from "react-router-dom";
export const TASK_DRAFT_DISCARD_MESSAGE = "离开任务详情后，当前未提交的内容将不会保存。确定离开吗？";
type Props = { dirty: boolean; busy: boolean; approvedNavigation: MutableRefObject<boolean> };
function DataRouterBlocker({ dirty, busy, approvedNavigation }: Props) {
  const flags = useRef({ dirty, busy }); flags.current = { dirty, busy };
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    if (approvedNavigation.current) { approvedNavigation.current = false; return false; }
    return (flags.current.dirty || flags.current.busy) && (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search);
  });
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (busy || !dirty) { blocker.reset(); return; }
    if (window.confirm(TASK_DRAFT_DISCARD_MESSAGE)) blocker.proceed();
    else blocker.reset();
  }, [blocker, busy, dirty]);
  return null;
}
/** Only this stable child calls useBlocker; BrowserRouter compatibility never calls a data-only hook. */
export function TaskDetailLeaveBlocker(props: Props) {
  const dataRouter = useContext(UNSAFE_DataRouterContext);
  return dataRouter ? <DataRouterBlocker {...props} /> : null;
}
