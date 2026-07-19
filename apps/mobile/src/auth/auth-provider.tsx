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
  createMobileClient,
  type MobileSession,
} from "@vercent/shared-sdk";

import { appConfig } from "@/config";
import { initializeDatabase, purgeOfflineWorkspace } from "@/data/database";
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

const client = createMobileClient({
  baseUrl: appConfig.apiUrl,
  tokenStore: secureTokenStore,
  clientVersion: appConfig.version,
});

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<AuthState>({
    status: "booting",
    session: null,
  });

  useEffect(() => {
    let active = true;
    client
      .session()
      .then(async ({ session }) => {
        await initializeDatabase();
        if (active) setState({ status: "signed-in", session });
      })
      .catch(async (error) => {
        if (error instanceof VercentApiError && error.status === 401) {
          await secureTokenStore.clear();
        }
        if (active) setState({ status: "signed-out", session: null });
      });
    return () => {
      active = false;
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await client.login({
      email: email.trim().toLowerCase(),
      password,
      device: await deviceContext(),
    });
    await initializeDatabase();
    setState({ status: "signed-in", session: result.session });
  }, []);

  const signOut = useCallback(async () => {
    try {
      await client.logout();
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
