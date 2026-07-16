# Vercent ERP API

Business-domain service boundary.

Authentication and cookie handling remain in protected Next.js Route Handlers under
`apps/web`. Those thin transport adapters call this package for governed Business Data
queries and mutations. The package accepts an already-authorized database client and a
tenant context, so it can later move behind a standalone API transport without moving
domain SQL back into the web application.

## CRM domain

`src/crm.js` owns tenant-scoped CRM services, scoring, assignment, conversion, pipeline movement, capture, automation and reporting.
