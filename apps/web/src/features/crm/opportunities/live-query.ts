// Query options for opportunity data that other people (or other tabs) can
// change: fetched fresh whenever the screen opens or the browser tab regains
// focus, and re-checked every 30 seconds while the tab is visible.
export const LIVE_OPPORTUNITY_QUERY = {
  staleTime: 0,
  refetchOnMount: "always",
  refetchOnWindowFocus: true,
  refetchInterval: 30_000,
  refetchIntervalInBackground: false,
} as const;
