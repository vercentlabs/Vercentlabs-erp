// The CRM workspace itself: Home (what needs attention today) and the
// organization's defaults for new tasks and follow-ups.
export { getCrmHome } from "./home.js";
export { getWorkDefaults, saveWorkDefaults, workDefaultChoices } from "./defaults.js";
export { getWorkingWeek, workSchedule } from "./working-week.js";
