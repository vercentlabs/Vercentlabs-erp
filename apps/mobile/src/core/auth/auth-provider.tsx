import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import {
  VercentApiError,
  type MobileSession,
} from "@vercent/shared-sdk";

import { mobileApi } from "@/core/api/client";
import {
  bindOfflineWorkspace,
  purgeOfflineWorkspace,
} from "@/core/database/database";
import { deviceContext } from "./device";
import { secureTokenStore } from "./token-store";

type AuthState =
  | { status: "booting"; session: null }
  | { status: "signed-out"; session: null }
  | { status: "signed-in"; session: MobileSession };

type AuthContextValue = AuthState & {
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function workspaceOwner(session: MobileSession) {
  return `${session.user.id}:${session.workspace.organizationId ?? "none"}`;
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<AuthState>({
    status: "booting",
    session: null,
  });

  useEffect(() => {
    let active = true;
    mobileApi
      .session()
      .then(async ({ session }) => {
        await bindOfflineWorkspace(workspaceOwner(session));
        if (active) setState({ status: "signed-in", session });
      })
      .catch(async (error) => {
        if (error instanceof VercentApiError && error.status === 401) {
          await secureTokenStore.clear();
          await purgeOfflineWorkspace().catch(() => undefined);
        }
        if (active) setState({ status: "signed-out", session: null });
      });
    return () => {
      active = false;
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await mobileApi.login({
      email: email.trim().toLowerCase(),
      password,
      device: await deviceContext(),
    });
    await bindOfflineWorkspace(workspaceOwner(result.session));
    setState({ status: "signed-in", session: result.session });
  }, []);

  const signOut = useCallback(async () => {
    try {
      await mobileApi.logout();
    } finally {
      await purgeOfflineWorkspace().catch(() => undefined);
      await secureTokenStore.clear();
      setState({ status: "signed-out", session: null });
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, signIn, signOut }),
    [state, signIn, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider.");
  return value;
}

export function authErrorMessage(error: unknown) {
  if (error instanceof VercentApiError) return error.message;
  return "We could not sign you in. Check your connection and try again.";
}
