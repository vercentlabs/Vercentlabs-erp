// One definition of where the specs send requests, matching playwright.config.ts (port 3001 unless overridden).
// Several specs used to default to port 3000, where the marketing site can be running, and got its 404 page back.
export const BASE_URL = process.env.QA_BASE_URL ?? `http://localhost:${process.env.QA_PORT ?? "3001"}`;
