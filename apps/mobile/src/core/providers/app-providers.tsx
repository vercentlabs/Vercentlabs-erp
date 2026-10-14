import { useEffect, useState, type PropsWithChildren } from "react";
import { AppState, Platform } from "react-native";
import * as Network from "expo-network";
import {
  QueryClient,
  QueryClientProvider,
  focusManager,
  onlineManager,
} from "@tanstack/react-query";

import { AuthProvider } from "@/core/auth/auth-provider";
import { ThemeProvider } from "@/shared/theme/theme";
import { PrivacyShield } from "@/core/security/privacy-shield";
import { AppErrorBoundary } from "@/shared/components/app-error-boundary";

function AuthenticatedConnectivity({ children }: PropsWithChildren) {
  useEffect(() => {
    onlineManager.setEventListener((setOnline) => {
      const subscription = Network.addNetworkStateListener((state) => {
        const connected = Boolean(state.isConnected);
        setOnline(connected);
      });
      void Network.getNetworkStateAsync().then((state) => {
        setOnline(Boolean(state.isConnected));
      });
      return () => subscription.remove();
    });
  }, []);

  return children;
}

export function AppProviders({ children }: PropsWithChildren) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 24 * 60 * 60 * 1_000,
            retry: (count, error) =>
              count < 2 &&
              (error as { retryable?: boolean }).retryable !== false,
          },
          mutations: { retry: false },
        },
      }),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (status) => {
      if (Platform.OS !== "web") focusManager.setFocused(status === "active");
    });
    return () => subscription.remove();
  }, []);

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AppErrorBoundary>
          <AuthProvider>
            <AuthenticatedConnectivity>
              <PrivacyShield>{children}</PrivacyShield>
            </AuthenticatedConnectivity>
          </AuthProvider>
        </AppErrorBoundary>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
