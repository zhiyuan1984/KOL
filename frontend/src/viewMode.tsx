import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAccount } from "./components/AuthGate";

const DEBUG_KEY = "ui:debug-view";

export function isAdminAccount(me?: {
  available_modes?: string[] | null;
  roles?: string[] | null;
} | null): boolean {
  return Boolean(me?.available_modes?.includes("admin") || me?.roles?.includes("admin"));
}

type ViewModeValue = {
  admin: boolean;
  debug: boolean;
  setDebug: (on: boolean) => void;
};

const ViewModeContext = createContext<ViewModeValue>({
  admin: false,
  debug: false,
  setDebug: () => undefined,
});

export function ViewModeProvider({ children }: { children: ReactNode }) {
  const { account } = useAccount();
  const admin = isAdminAccount(account);
  const [debug, setDebugState] = useState(false);

  useEffect(() => {
    if (!admin) {
      setDebugState(false);
      return;
    }
    setDebugState(localStorage.getItem(DEBUG_KEY) === "true");
  }, [admin, account?.id]);

  const setDebug = (on: boolean) => {
    if (!admin) return;
    localStorage.setItem(DEBUG_KEY, String(on));
    setDebugState(on);
  };

  const value = useMemo(
    () => ({ admin, debug: admin && debug, setDebug }),
    [admin, debug],
  );
  return <ViewModeContext.Provider value={value}>{children}</ViewModeContext.Provider>;
}

export function useViewMode(): ViewModeValue {
  return useContext(ViewModeContext);
}
