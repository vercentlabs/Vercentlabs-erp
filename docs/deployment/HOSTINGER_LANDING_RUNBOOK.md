# Hostinger landing deployment

This runbook deploys only `apps/landing`. It does not deploy the ERP web app,
API, worker, PostgreSQL, or Redis.

## Production contract

- Canonical marketing URL: `https://www.vercentlabs.com`
- Apex behavior: `https://vercentlabs.com` redirects permanently to the
  canonical `www` URL.
- Runtime: Node.js 24, pnpm 11.21.0, Next.js standalone server.
- Build command from the repository root: `pnpm build`
- Start command from the repository root: `pnpm start`
- Application port: `3000` (Hostinger supplies `PORT`; Next's standalone
  server consumes it).
- Repository root must remain the deployment root. The build depends on the
  root lockfile, workspace definition, and workspace packages.

The root `server.js` starts the generated file at
`apps/landing/.next/standalone/apps/landing/server.js`. The landing build also
copies `public` and `.next/static` into the standalone output.

## Required Hostinger environment variables

Configure these in hPanel. Do not commit their production values.

```dotenv
NEXT_PUBLIC_SITE_URL=https://www.vercentlabs.com
NEXT_PUBLIC_APP_URL=https://app.vercentlabs.com
CRM_CAPTURE_PROXY_SECRET=<at-least-32-random-characters>
CRM_CAPTURE_FORM_KEY=<production-CRM-capture-form-UUID>
TRUSTED_PROXY_IP_HEADER=<Hostinger-confirmed-overwritten-client-IP-header>
TRUSTED_PROXY_CLIENT_INDEX=0
```

`NEXT_PUBLIC_SITE_URL` and `NEXT_PUBLIC_APP_URL` are embedded during the
Next.js build, so they must be present before the build starts. Redeploy after
changing either value.

`CRM_CAPTURE_PROXY_SECRET` must exactly match the value on the ERP web app.
`CRM_CAPTURE_FORM_KEY` must identify the production CRM capture form belonging
to the organization that receives marketing leads.

Do not guess `TRUSTED_PROXY_IP_HEADER`. Confirm the header Hostinger overwrites
at its edge. Leaving it blank is fail-closed, but it puts all visitors into one
shared rate-limit bucket and is not suitable for launch traffic.

## Preconditions

1. Use a Hostinger plan that supports managed Node.js web applications and
   Node.js 24, or deploy the existing landing Dockerfile on a Hostinger VPS.
2. The `main` branch must pass Landing CI.
3. The ERP CRM capture endpoint must already be live at
   `${NEXT_PUBLIC_APP_URL}/api/crm/public/capture/${CRM_CAPTURE_FORM_KEY}`.
4. `app.vercentlabs.com` (or the actual value of `NEXT_PUBLIC_APP_URL`) must
   resolve over HTTPS before the marketing cutover.
5. Export or screenshot the current apex and `www` DNS records before changing
   them. The apex currently hosts an older site, so the cutover needs an
   explicit rollback record.

## Managed Node.js deployment (preferred)

1. In hPanel, add a Node.js web application and connect the GitHub repository
   `vercentlabs/Vercentlabs-erp`.
2. Select branch `main`, repository root `/`, Node.js `24`, and pnpm.
3. Set the build command to `pnpm build` and the start command to `pnpm start`.
4. Add all variables from the environment section before deploying.
5. Deploy first to Hostinger's temporary application URL. Do not attach the
   production domain yet.
6. Run the pre-cutover checks below against that temporary URL.
7. Attach `www.vercentlabs.com` only after the temporary deployment passes.
8. Configure the apex domain to redirect permanently to
   `https://www.vercentlabs.com`. Keep only one canonical origin.
9. Enable automatic deployment from `main` only after the first controlled
   deployment and rollback test have succeeded.

If hPanel cannot build the monorepo with the configured root commands, use the
existing `infrastructure/docker/Dockerfile.landing` on a Hostinger VPS instead
of copying build artifacts manually.

## Pre-cutover checks

Replace `<preview-origin>` with the Hostinger temporary application origin.

```powershell
curl.exe -fsS -o NUL -w "%{http_code}`n" <preview-origin>/
curl.exe -fsS -o NUL -w "%{http_code}`n" <preview-origin>/book-demo
curl.exe -fsS <preview-origin>/robots.txt
curl.exe -fsS <preview-origin>/sitemap.xml
```

Expected results:

- `/` and `/book-demo` return `200`.
- `/robots.txt` and `/sitemap.xml` return real generated content.
- Page source uses the intended canonical production domain.
- The browser console has no application errors.
- Navigation, mobile menu, module map, resource links, and Book a Demo form
  work at desktop and mobile widths.
- A real test demo request reaches the intended CRM organization exactly once.
- Invalid form data is rejected without creating a CRM lead.
- Security headers include CSP, frame denial, nosniff, referrer policy, and
  HSTS on the HTTPS production deployment.

## Cutover verification

After DNS/Hostinger domain attachment has propagated:

```powershell
Resolve-DnsName vercentlabs.com
Resolve-DnsName www.vercentlabs.com
Resolve-DnsName app.vercentlabs.com
curl.exe -fsSI https://www.vercentlabs.com/
curl.exe -fsSI https://vercentlabs.com/
curl.exe -fsS https://www.vercentlabs.com/robots.txt
curl.exe -fsS https://www.vercentlabs.com/sitemap.xml
```

Verify that:

- `www` serves this Next.js landing app over a valid certificate.
- The apex redirects to `www` and does not render the retired PHP site.
- `app` resolves to the live ERP web application.
- `/book-demo` submits successfully to CRM.
- Hostinger logs contain no boot loop, failed upstream request, or unexpected
  rate-limit burst.

## Rollback

If the landing application or CRM submission path fails after cutover:

1. Restore the recorded prior DNS/domain assignment.
2. Redeploy the last known-good Hostinger deployment or previous Git commit.
3. Do not lower CRM authentication or same-origin protections to work around a
   deployment failure.
4. Preserve Hostinger application logs and the failing request ID before the
   next attempt.
