# User-journey tests

The `*.test.mjs` files in this directory are source and contract guards. They
verify that routes, commands and permission boundaries remain wired, but they
do not prove that a running application completed a user journey.

The real Stage 1 application journey is `pnpm test:platform-live`. It starts the
ERP web application, uses a real PostgreSQL database, submits repeated native
login failures, signs in through Chromium, opens a permitted Sales route and
verifies direct-route denial for a restricted user.

Future module stages must add live journeys rather than treating source-string
checks as end-to-end acceptance.
