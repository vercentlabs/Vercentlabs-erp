// Query options for lead data that other people (or other tabs) can change:
// fetched fresh whenever the screen opens or the browser tab regains focus,
// and re-checked every 30 seconds while the tab is visible. Changes made on
// this screen are applied immediately through cache invalidation; these
// options cover the changes made elsewhere.
export const LIVE_LEAD_QUERY = {
  staleTime: 0,
  refetchOnMount: "always",
  refetchOnWindowFocus: true,
  refetchInterval: 30_000,
  refetchIntervalInBackground: false,
} as const;
