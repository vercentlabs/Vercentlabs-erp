// Query options for account data that other people (or other tabs) can
// change: fetched fresh whenever the screen opens or the browser tab regains
// focus, and re-checked every 30 seconds while the tab is visible. Changes
// made on this screen are applied immediately through cache invalidation.
export { LIVE_LEAD_QUERY as LIVE_ACCOUNT_QUERY } from "@/features/crm/leads/live-query";
