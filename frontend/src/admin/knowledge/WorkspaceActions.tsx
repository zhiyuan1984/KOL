import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";
export const WorkspaceActionContext=createContext<HTMLElement|null>(null);
export default function WorkspaceActions({children}:{children:ReactNode}) {
  const target=useContext(WorkspaceActionContext);
  return target ? createPortal(children,target):<div className="kbv-inline-actions">{children}</div>;
}
