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
  VercentlabsApiError,
  type MobileSession,
} from "@vercentlabs/shared-sdk";

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
  | { status: "unavailable"; session: null; message: string }
  | { status: "signed-in"; session: MobileSession };

type AuthContextValue = AuthState & {
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  retrySession(): Promise<void>;
  refreshSession(): Promise<void>;
  applySession(session: MobileSession): Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function workspaceOwner(session: MobileSession) {
  return `${session.user.id}:${session.workspace.organizationId ?? "none"}`;
}

async function loadStoredSession(): Promise<AuthState> {
  try {
    const { session } = await mobileApi.session();
    await bindOfflineWorkspace(workspaceOwner(session));
    return { status: "signed-in", session };
  } catch (error) {
    if (error instanceof VercentlabsApiError && error.status === 401) {
      await secureTokenStore.clear();
      await purgeOfflineWorkspace().catch(() => undefined);
      return { status: "signed-out", session: null };
    }
    return {
      status: "unavailable",
      session: null,
      message:
        error instanceof Error
          ? error.message
          : "The saved session could not be checked.",
    };
  }
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<AuthState>({
    status: "booting",
    session: null,
  });

  useEffect(() => {
    let active = true;
    const unsubscribe = mobileApi.setAuthenticationFailureHandler(async () => {
      await purgeOfflineWorkspace().catch(() => undefined);
      if (active) setState({ status: "signed-out", session: null });
    });

    void loadStoredSession().then((next) => {
      if (active) setState(next);
    });

    return () => {
      active = false;
      unsubscribe();
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

  const applySession = useCallback(async (session: MobileSession) => {
    await bindOfflineWorkspace(workspaceOwner(session));
    setState({ status: "signed-in", session });
  }, []);

  const retrySession = useCallback(async () => {
    setState({ status: "booting", session: null });
    setState(await loadStoredSession());
  }, []);

  const refreshSession = useCallback(async () => {
    const { session } = await mobileApi.session();
    await applySession(session);
  }, [applySession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      signIn,
      signOut,
      retrySession,
      refreshSession,
      applySession,
    }),
    [state, signIn, signOut, retrySession, refreshSession, applySession],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider.");
  return value;
}

export function authErrorMessage(error: unknown) {
  if (error instanceof VercentlabsApiError) return error.message;
  return "We could not sign you in. Check your connection and try again.";
}
