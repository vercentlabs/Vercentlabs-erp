// Hostinger deploys this monorepo from its root. The landing production server
// is emitted by Next.js inside the standalone workspace output during build.
require("./apps/landing/.next/standalone/apps/landing/server.js");