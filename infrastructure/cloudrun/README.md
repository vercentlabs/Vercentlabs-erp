# Going live: Google Cloud Run + Cloud SQL, domain at Hostinger

```
vercentlabs.com, www  ──┐                          ┌─> vercentlabs-landing (Cloud Run)
                        ├─> HTTPS load balancer ───┤
app.vercentlabs.com   ──┘   (static IP, Google     └─> vercentlabs-web (Cloud Run) ──┐
                             certificate)                                           ├─> Cloud SQL PostgreSQL 16 (Mumbai)
                            vercentlabs-worker (Cloud Run, always on, not public) ─┘   Cloud Storage (files), KMS (secrets)
                            erp-migration (Cloud Run Job, every release)
```

Region `asia-south1` (Mumbai). Email stays at Hostinger: sign-in codes go out through a Hostinger mailbox, and Hostinger's MX
records are left alone.

## Cost (approximate, at small scale)

| Part | Per month |
|---|---|
| Cloud SQL `db-custom-1-3840`, 20 GB, backups | ₹4,500 (`db-g1-small`: ₹2,300) |
| Web (1 always-warm instance) | ₹1,500–2,500 |
| Worker (always on) | ₹2,500–3,500 |
| Load balancer + IP | ₹1,600 |
| Landing, storage, KMS, Secret Manager, builds | ₹200–500 |
| **Total** | **≈ ₹10,000–12,500** |

Set a budget alert: Google Cloud › Billing › Budgets & alerts.

## Before the first run (once)

1. **Google Cloud project with billing.** console.cloud.google.com › select the project (or create `vercentlabs-erp-prod`) ›
   Billing › link a billing account.
2. **Google Cloud CLI.** Install it from https://cloud.google.com/sdk/docs/install (Windows installer), then in Git Bash:
   ```sh
   gcloud auth login
   gcloud config set project <PROJECT_ID>
   ```
3. **Hostinger mailbox for outgoing mail.** hPanel › Emails › your domain › create `noreply@vercentlabs.com`
   (and `support@vercentlabs.com` for replies if you want one). Keep its password ready.
4. **Google OAuth client** (the one used locally): Google Auth Platform › Clients › your client › add these redirect URIs:
   ```
   https://app.vercentlabs.com/api/settings/integrations/oauth/callback/google
   https://app.vercentlabs.com/api/auth/oauth/google/callback
   https://app.vercentlabs.com/api/crm/calendar/callback/google
   ```
   Branding › add `vercentlabs.com` under Authorised domains.
5. **Settings.** `cp infrastructure/cloudrun/deploy.env.example infrastructure/cloudrun/deploy.env` and fill in `PROJECT_ID` and
   `GOOGLE_OAUTH_CLIENT_ID`.

## Deploy

From the repo root, in Git Bash:

```sh
infrastructure/cloudrun/deploy.sh setup     # ~15 min (Cloud SQL creation). Asks once for the mailbox and Google OAuth passwords.
infrastructure/cloudrun/deploy.sh release   # ~15–20 min: build, migrate, deploy web, worker and landing.
infrastructure/cloudrun/deploy.sh network   # ~3 min: load balancer and certificate; prints the DNS records.
```

## DNS at Hostinger

hPanel › Domains › vercentlabs.com › **DNS / Nameservers** › DNS records:

1. Delete existing **A**, **AAAA** and **CNAME** records for `@`, `www` and `app` (the ones pointing at Hostinger's web hosting).
   **Keep MX, TXT (SPF/DKIM) and the `mail`/`autodiscover` records** — they carry your email.
2. Add three **A** records, all to the IP that `deploy.sh network` printed: `@`, `www`, `app` (TTL 3600).
3. Wait. DNS takes 5–60 minutes; the Google certificate becomes **ACTIVE** 15–60 minutes after that
   (`deploy.sh status`). Until then https:// shows a certificate error — that is expected.

If the Hostinger plan's website should keep working somewhere else, give it another subdomain; vercentlabs.com itself now serves
the landing site from Cloud Run.

## Check it works

- https://vercentlabs.com — landing; **Start free trial** goes to https://app.vercentlabs.com/register
- https://app.vercentlabs.com/api/readiness — `{"status":"ok"}` (database role, migrations, storage)
- Register a company: the sign-in code arrives from noreply@vercentlabs.com
- Settings › Integrations: Google is set up; CRM › Setup › My calendar: Connect works

## Every release afterwards

```sh
git pull && infrastructure/cloudrun/deploy.sh release
```

Migrations run first (only the new ones); if one fails, the web and worker are not updated and the previous release keeps
serving. Roll back a bad release: Cloud Run › service › Revisions › route 100% to the previous revision.

## Turning on paid plans (later)

Add Razorpay **live** keys to Secret Manager (`RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`), set `RAZORPAY_KEY_ID`,
`RAZORPAY_MODE=live` and `BILLING_CHECKOUT_ENABLED=true`, and run `deploy.sh release`.
The Razorpay webhook URL is `https://app.vercentlabs.com/api/billing/webhook`.

## Where things are

| What | Where |
|---|---|
| Logs | Cloud Run › service › Logs (structured JSON) |
| Database | Cloud SQL › vercentlabs-db (`gcloud sql connect vercentlabs-db --user=vercent_owner --database=vercentlabs`) |
| Backups | Cloud SQL › Backups (daily, 14 kept, point-in-time recovery) |
| Secrets | Secret Manager (database URLs, passwords, SMTP, OAuth) |
| Files | Cloud Storage › `<project>-erp-files` |
