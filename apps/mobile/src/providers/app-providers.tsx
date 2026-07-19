import { useEffect, useState, type PropsWithChildren } from "react";
import { AppState, Platform } from "react-native";
import * as Network from "expo-network";
import {
  QueryClient,
  QueryClientProvider,
  focusManager,
  onlineManager,
} from "@tanstack/react-query";

import { AuthProvider } from "@/auth/auth-provider";
import { ThemeProvider } from "@/theme/theme";
import { flushMutationQueue } from "@/data/sync";
import { PrivacyShield } from "@/security/privacy-shield";
import { AppErrorBoundary } from "@/ui/app-error-boundary";

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
    onlineManager.setEventListener((setOnline) => {
      const subscription = Network.addNetworkStateListener((state) => {
        setOnline(Boolean(state.isConnected));
        if (state.isConnected) void flushMutationQueue();
      });
      void Network.getNetworkStateAsync().then((state) => {
        setOnline(Boolean(state.isConnected));
      });
      return () => subscription.remove();
    });
    const subscription = AppState.addEventListener("change", (status) => {
      if (Platform.OS !== "web") focusManager.setFocused(status === "active");
    });
    return () => subscription.remove();
  }, []);

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AppErrorBoundary><AuthProvider><PrivacyShield>{children}</PrivacyShield></AuthProvider></AppErrorBoundary>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
