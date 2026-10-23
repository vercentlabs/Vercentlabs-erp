#!/usr/bin/env bash
# Vercentlabs ERP on Google Cloud Run + Cloud SQL (Mumbai, asia-south1), with the domain kept at Hostinger.
#
#   vercentlabs.com, www.vercentlabs.com  -> landing   (Cloud Run)
#   app.vercentlabs.com                   -> web/API   (Cloud Run)
#   worker                                -> background jobs (Cloud Run, always on, not public)
#   migration                             -> Cloud Run Job, run on every release before the web and worker roll out
#
# One HTTPS load balancer (static IP + Google-managed certificate) fronts the two public services; Hostinger's DNS points at its IP.
# Every step checks what already exists, so the script is run for the first setup and again for every release:
#
#   infrastructure/cloudrun/deploy.sh setup     # first time: APIs, registry, database, bucket, KMS, secrets, service accounts
#   infrastructure/cloudrun/deploy.sh release   # build images, migrate, deploy web/worker/landing
#   infrastructure/cloudrun/deploy.sh network   # load balancer + certificate; prints the DNS records for Hostinger
#   infrastructure/cloudrun/deploy.sh all       # the three in order
#   infrastructure/cloudrun/deploy.sh status    # what is running, the IP, the certificate state
#
# Settings come from infrastructure/cloudrun/deploy.env (copy deploy.env.example). Passwords are generated once into Secret Manager;
# nothing secret is written to disk or printed.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
[[ -f "$HERE/deploy.env" ]] || { echo "Missing $HERE/deploy.env (copy deploy.env.example and fill it in)."; exit 1; }
# shellcheck disable=SC1091
source "$HERE/deploy.env"

: "${PROJECT_ID:?set PROJECT_ID in deploy.env}"
REGION="${REGION:-asia-south1}"
SITE_DOMAIN="${SITE_DOMAIN:-vercentlabs.com}"
APP_DOMAIN="${APP_DOMAIN:-app.vercentlabs.com}"
SQL_INSTANCE="${SQL_INSTANCE:-vercentlabs-db}"
SQL_TIER="${SQL_TIER:-db-custom-1-3840}"
DB_NAME="${DB_NAME:-vercentlabs}"
BUCKET="${BUCKET:-${PROJECT_ID}-erp-files}"
REPOSITORY="${REPOSITORY:-vercentlabs}"
TAG="${TAG:-$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M)}"
: "${SMTP_HOST:?set SMTP_HOST}" "${SMTP_USER:?set SMTP_USER}" "${AUTH_EMAIL_FROM:?set AUTH_EMAIL_FROM}"
SMTP_PORT="${SMTP_PORT:-465}"
SMTP_SECURE="${SMTP_SECURE:-true}"

GC=(gcloud --project "$PROJECT_ID" --quiet)
REGISTRY="$REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY"
CONNECTION="$PROJECT_ID:$REGION:$SQL_INSTANCE"
KMS_KEY="projects/$PROJECT_ID/locations/$REGION/keyRings/vercentlabs/cryptoKeys/secrets"
SA_WEB="vercentlabs-web@$PROJECT_ID.iam.gserviceaccount.com"
SA_WORKER="vercentlabs-worker@$PROJECT_ID.iam.gserviceaccount.com"
SA_MIGRATION="vercentlabs-migration@$PROJECT_ID.iam.gserviceaccount.com"

say() { printf '\n== %s\n' "$*"; }
exists() { "$@" >/dev/null 2>&1; }
password() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 40; }
# A secret is created once (from stdin) and never overwritten here; rotate it in Secret Manager when needed.
secret_once() {
  local name="$1" value="$2"
  if exists "${GC[@]}" secrets describe "$name"; then return; fi
  printf '%s' "$value" | "${GC[@]}" secrets create "$name" --replication-policy=user-managed --locations="$REGION" --data-file=-
}
secret_value() { "${GC[@]}" secrets versions access latest --secret="$1"; }
grant_secret() { "${GC[@]}" secrets add-iam-policy-binding "$1" --member="serviceAccount:$2" --role=roles/secretmanager.secretAccessor >/dev/null; }

setup() {
  say "APIs"
  "${GC[@]}" services enable run.googleapis.com sqladmin.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com \
    secretmanager.googleapis.com cloudkms.googleapis.com compute.googleapis.com storage.googleapis.com iam.googleapis.com calendar-json.googleapis.com

  say "Artifact Registry"
  exists "${GC[@]}" artifacts repositories describe "$REPOSITORY" --location="$REGION" ||
    "${GC[@]}" artifacts repositories create "$REPOSITORY" --repository-format=docker --location="$REGION" --description="Vercentlabs ERP images"

  say "Service accounts"
  for name in web worker migration; do
    exists "${GC[@]}" iam service-accounts describe "vercentlabs-$name@$PROJECT_ID.iam.gserviceaccount.com" ||
      "${GC[@]}" iam service-accounts create "vercentlabs-$name" --display-name="Vercentlabs ERP $name"
  done
  for sa in "$SA_WEB" "$SA_WORKER" "$SA_MIGRATION"; do
    "${GC[@]}" projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$sa" --role=roles/cloudsql.client --condition=None >/dev/null
  done

  say "KMS key (encrypts stored integration tokens and secrets)"
  exists "${GC[@]}" kms keyrings describe vercentlabs --location="$REGION" || "${GC[@]}" kms keyrings create vercentlabs --location="$REGION"
  exists "${GC[@]}" kms keys describe secrets --keyring=vercentlabs --location="$REGION" ||
    "${GC[@]}" kms keys create secrets --keyring=vercentlabs --location="$REGION" --purpose=encryption --rotation-period=90d \
      --next-rotation-time="$(date -u -d '+90 days' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v+90d +%Y-%m-%dT%H:%M:%SZ)"
  for sa in "$SA_WEB" "$SA_WORKER"; do
    "${GC[@]}" kms keys add-iam-policy-binding secrets --keyring=vercentlabs --location="$REGION" \
      --member="serviceAccount:$sa" --role=roles/cloudkms.cryptoKeyEncrypterDecrypter >/dev/null
  done

  say "File bucket (private)"
  exists "${GC[@]}" storage buckets describe "gs://$BUCKET" ||
    "${GC[@]}" storage buckets create "gs://$BUCKET" --location="$REGION" --uniform-bucket-level-access --public-access-prevention
  for sa in "$SA_WEB" "$SA_WORKER"; do
    "${GC[@]}" storage buckets add-iam-policy-binding "gs://$BUCKET" --member="serviceAccount:$sa" --role=roles/storage.objectAdmin >/dev/null
  done

  say "Cloud SQL (PostgreSQL 16) — first creation takes 5–10 minutes"
  exists "${GC[@]}" sql instances describe "$SQL_INSTANCE" ||
    "${GC[@]}" sql instances create "$SQL_INSTANCE" --database-version=POSTGRES_16 --region="$REGION" --tier="$SQL_TIER" \
      --edition=ENTERPRISE --storage-type=SSD --storage-size=20 --storage-auto-increase --availability-type=zonal \
      --backup-start-time=20:30 --enable-point-in-time-recovery --retained-backups-count=14 \
      --maintenance-window-day=SUN --maintenance-window-hour=21 --deletion-protection
  exists "${GC[@]}" sql databases describe "$DB_NAME" --instance="$SQL_INSTANCE" || "${GC[@]}" sql databases create "$DB_NAME" --instance="$SQL_INSTANCE"

  say "Database passwords and connection strings (Secret Manager)"
  secret_once OWNER_DB_PASSWORD "$(password)"
  secret_once APP_DB_PASSWORD "$(password)"
  secret_once WORKER_DB_PASSWORD "$(password)"
  local owner_password; owner_password="$(secret_value OWNER_DB_PASSWORD)"
  if ! "${GC[@]}" sql users list --instance="$SQL_INSTANCE" --format='value(name)' | grep -qx vercent_owner; then
    "${GC[@]}" sql users create vercent_owner --instance="$SQL_INSTANCE" --password="$owner_password"
  fi
  local socket="host=/cloudsql/$CONNECTION"
  secret_once MIGRATION_DATABASE_URL "postgresql://vercent_owner:$owner_password@localhost/$DB_NAME?$socket"
  secret_once DATABASE_URL "postgresql://vercent_app:$(secret_value APP_DB_PASSWORD)@localhost/$DB_NAME?$socket"
  secret_once WORKER_DATABASE_URL "postgresql://vercent_worker:$(secret_value WORKER_DB_PASSWORD)@localhost/$DB_NAME?$socket"

  say "Mail and Google sign-in secrets"
  # Asked for in a terminal, or taken from SMTP_PASSWORD_VALUE / GOOGLE_OAUTH_CLIENT_SECRET_VALUE; without either, skipped with the
  # command that adds it (the release needs SMTP_PASSWORD).
  if ! exists "${GC[@]}" secrets describe SMTP_PASSWORD; then
    local smtp_password="${SMTP_PASSWORD_VALUE:-}"
    [[ -z "$smtp_password" && -t 0 ]] && { read -r -s -p "Password (or app password) of the mailbox $SMTP_USER: " smtp_password; echo; }
    if [[ -n "$smtp_password" ]]; then secret_once SMTP_PASSWORD "$smtp_password"
    else echo "SKIPPED: add the mailbox password before the release: printf '%s' '<password>' | gcloud secrets create SMTP_PASSWORD --replication-policy=user-managed --locations=$REGION --data-file=-"; fi
  fi
  if [[ -n "${GOOGLE_OAUTH_CLIENT_ID:-}" ]] && ! exists "${GC[@]}" secrets describe GOOGLE_OAUTH_CLIENT_SECRET; then
    local google_secret="${GOOGLE_OAUTH_CLIENT_SECRET_VALUE:-}"
    [[ -z "$google_secret" && -t 0 ]] && { read -r -s -p "Google OAuth client secret: " google_secret; echo; }
    [[ -n "$google_secret" ]] && secret_once GOOGLE_OAUTH_CLIENT_SECRET "$google_secret"
  fi

  say "Who reads which secret"
  for name in MIGRATION_DATABASE_URL APP_DB_PASSWORD WORKER_DB_PASSWORD; do grant_secret "$name" "$SA_MIGRATION"; done
  grant_secret DATABASE_URL "$SA_WEB"
  grant_secret WORKER_DATABASE_URL "$SA_WORKER"
  for sa in "$SA_WEB" "$SA_WORKER"; do
    exists "${GC[@]}" secrets describe SMTP_PASSWORD && grant_secret SMTP_PASSWORD "$sa"
    exists "${GC[@]}" secrets describe GOOGLE_OAUTH_CLIENT_SECRET && grant_secret GOOGLE_OAUTH_CLIENT_SECRET "$sa"
  done

  say "Cloud Build may push images and deploy as the runtime accounts"
  local number; number="$("${GC[@]}" projects describe "$PROJECT_ID" --format='value(projectNumber)')"
  "${GC[@]}" projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$number@cloudbuild.gserviceaccount.com" \
    --role=roles/artifactregistry.writer --condition=None >/dev/null
  # Newer projects build as the default compute account: it needs the builder role (source bucket, images, logs).
  for role in roles/cloudbuild.builds.builder roles/logging.logWriter; do
    "${GC[@]}" projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$number-compute@developer.gserviceaccount.com" \
      --role="$role" --condition=None >/dev/null
  done
  echo "Setup done."
}

# The settings every web and worker revision runs with (secrets are added separately).
runtime_env() {
  local pool="$1"
  local origins="https://$APP_DOMAIN,https://$SITE_DOMAIN,https://www.$SITE_DOMAIN"
  local google=""
  [[ -n "${GOOGLE_OAUTH_CLIENT_ID:-}" ]] && google="|GOOGLE_OAUTH_CLIENT_ID=$GOOGLE_OAUTH_CLIENT_ID"
  # "^|^" makes | the separator, because FORM_ALLOWED_ORIGINS holds commas.
  printf '%s' "^|^NODE_ENV=production|DEPLOYMENT_ENVIRONMENT=production|RELEASE_SHA=$TAG|APP_URL=https://$APP_DOMAIN|FORM_ALLOWED_ORIGINS=$origins\
|TRUSTED_PROXY_IP_HEADER=x-forwarded-for|TRUSTED_PROXY_CLIENT_INDEX=-2|DATABASE_SSL=false|DATABASE_POOL_MAX=$pool\
|SESSION_COOKIE_NAME=vercent_session|BILLING_ENFORCEMENT_MODE=enforce|BILLING_CHECKOUT_ENABLED=${BILLING_CHECKOUT_ENABLED:-false}\
|FILE_STORAGE_DRIVER=gcs|FILE_STORAGE_GCS_BUCKET=$BUCKET|ATTACHMENT_SCAN_MODE=local\
|SECRETS_ENCRYPTION_PROVIDER=gcp-kms|SECRETS_KMS_KEY_NAME=$KMS_KEY\
|SMTP_HOST=$SMTP_HOST|SMTP_PORT=$SMTP_PORT|SMTP_SECURE=$SMTP_SECURE|SMTP_USER=$SMTP_USER|AUTH_EMAIL_FROM=$AUTH_EMAIL_FROM|AUTH_EMAIL_REPLY_TO=${AUTH_EMAIL_REPLY_TO:-$SMTP_USER}$google"
}
runtime_secrets() {
  local database="$1"
  local list="$database=$database:latest,SMTP_PASSWORD=SMTP_PASSWORD:latest"
  exists "${GC[@]}" secrets describe GOOGLE_OAUTH_CLIENT_SECRET && list="$list,GOOGLE_OAUTH_CLIENT_SECRET=GOOGLE_OAUTH_CLIENT_SECRET:latest"
  printf '%s' "$list"
}

# The four images built with this machine's Docker and pushed to Artifact Registry: for a project whose Cloud Build quota does not yet
# allow a machine large enough for the Next.js builds. Then: SKIP_BUILD=1 deploy.sh release.
build_local() {
  say "Docker may push to $REGISTRY"
  "${GC[@]}" auth configure-docker "$REGION-docker.pkg.dev" >/dev/null
  local image
  for image in web worker migration landing; do
    say "Build and push $image:$TAG"
    local extra=()
    [[ "$image" == landing ]] && extra=(--build-arg "NEXT_PUBLIC_SITE_URL=https://$SITE_DOMAIN" --build-arg "NEXT_PUBLIC_APP_URL=https://$APP_DOMAIN")
    (cd "$ROOT" && DOCKER_BUILDKIT=1 docker build --platform=linux/amd64 -f "infrastructure/docker/Dockerfile.$image" --build-arg "GIT_SHA=$TAG" "${extra[@]}" \
      -t "$REGISTRY/$image:$TAG" .)
    docker push "$REGISTRY/$image:$TAG"
  done
}

release() {
  if [[ "${SKIP_BUILD:-}" == 1 ]]; then
    say "Using the images already pushed for $TAG"
  else
    say "Build the four images in Cloud Build (tag $TAG) — about 10–15 minutes"
    (cd "$ROOT" && "${GC[@]}" builds submit --config infrastructure/cloudrun/cloudbuild.yaml --region="$REGION" \
      --substitutions="_REGION=$REGION,_REPOSITORY=$REPOSITORY,_TAG=$TAG,_SITE_URL=https://$SITE_DOMAIN,_APP_URL=https://$APP_DOMAIN" .)
  fi

  say "Migrate the database (and set the web and worker database logins)"
  local job_args=(--image="$REGISTRY/migration:$TAG" --region="$REGION" --service-account="$SA_MIGRATION" --set-cloudsql-instances="$CONNECTION"
    --set-env-vars="NODE_ENV=production,DATABASE_SSL=false,RELEASE_SHA=$TAG"
    --set-secrets="MIGRATION_DATABASE_URL=MIGRATION_DATABASE_URL:latest,APP_DB_PASSWORD=APP_DB_PASSWORD:latest,WORKER_DB_PASSWORD=WORKER_DB_PASSWORD:latest"
    --task-timeout=30m --max-retries=0 --memory=1Gi)
  if exists "${GC[@]}" run jobs describe erp-migration --region="$REGION"; then "${GC[@]}" run jobs update erp-migration "${job_args[@]}"
  else "${GC[@]}" run jobs create erp-migration "${job_args[@]}"; fi
  "${GC[@]}" run jobs execute erp-migration --region="$REGION" --wait

  say "Web (app.$SITE_DOMAIN)"
  "${GC[@]}" run deploy vercentlabs-web --image="$REGISTRY/web:$TAG" --region="$REGION" --service-account="$SA_WEB" --port=3001 \
    --add-cloudsql-instances="$CONNECTION" --set-env-vars="$(runtime_env 10)" --set-secrets="$(runtime_secrets DATABASE_URL)" \
    --cpu=1 --memory=1Gi --min-instances=1 --max-instances=6 --concurrency=60 --timeout=300 --cpu-boost \
    --ingress=internal-and-cloud-load-balancing --allow-unauthenticated

  say "Worker (always on, not public)"
  "${GC[@]}" run deploy vercentlabs-worker --image="$REGISTRY/worker:$TAG" --region="$REGION" --service-account="$SA_WORKER" --port=8081 \
    --add-cloudsql-instances="$CONNECTION" --set-env-vars="$(runtime_env 8)|WORKER_HEALTH_PORT=8081|WORKER_CONCURRENCY=2" \
    --set-secrets="$(runtime_secrets WORKER_DATABASE_URL)" \
    --cpu=1 --memory=1Gi --min-instances=1 --max-instances=1 --no-cpu-throttling --ingress=internal --no-allow-unauthenticated

  say "Landing ($SITE_DOMAIN)"
  "${GC[@]}" run deploy vercentlabs-landing --image="$REGISTRY/landing:$TAG" --region="$REGION" --port=3000 \
    --set-env-vars="^|^NODE_ENV=production|NEXT_PUBLIC_SITE_URL=https://$SITE_DOMAIN|NEXT_PUBLIC_APP_URL=https://$APP_DOMAIN|FORM_ALLOWED_ORIGINS=https://$SITE_DOMAIN,https://www.$SITE_DOMAIN" \
    --cpu=1 --memory=512Mi --min-instances=0 --max-instances=4 --ingress=internal-and-cloud-load-balancing --allow-unauthenticated
  echo "Release $TAG deployed."
}

network() {
  say "Static IP"
  exists "${GC[@]}" compute addresses describe vercentlabs-ip --global || "${GC[@]}" compute addresses create vercentlabs-ip --global --ip-version=IPV4
  local ip; ip="$("${GC[@]}" compute addresses describe vercentlabs-ip --global --format='value(address)')"

  say "Cloud Run behind the load balancer"
  for service in web landing; do
    exists "${GC[@]}" compute network-endpoint-groups describe "neg-$service" --region="$REGION" ||
      "${GC[@]}" compute network-endpoint-groups create "neg-$service" --region="$REGION" --network-endpoint-type=serverless --cloud-run-service="vercentlabs-$service"
    if ! exists "${GC[@]}" compute backend-services describe "backend-$service" --global; then
      "${GC[@]}" compute backend-services create "backend-$service" --global --load-balancing-scheme=EXTERNAL_MANAGED
      "${GC[@]}" compute backend-services add-backend "backend-$service" --global --network-endpoint-group="neg-$service" --network-endpoint-group-region="$REGION"
    fi
  done

  say "Hosts: $APP_DOMAIN -> web, $SITE_DOMAIN and www -> landing"
  if ! exists "${GC[@]}" compute url-maps describe vercentlabs-https --global; then
    "${GC[@]}" compute url-maps create vercentlabs-https --global --default-service=backend-landing
    "${GC[@]}" compute url-maps add-path-matcher vercentlabs-https --global --path-matcher-name=app --default-service=backend-web --new-hosts="$APP_DOMAIN"
  fi

  say "Google-managed certificate (becomes ACTIVE 15–60 minutes after the DNS records point here)"
  exists "${GC[@]}" compute ssl-certificates describe vercentlabs-cert --global ||
    "${GC[@]}" compute ssl-certificates create vercentlabs-cert --global --domains="$SITE_DOMAIN,www.$SITE_DOMAIN,$APP_DOMAIN"
  exists "${GC[@]}" compute target-https-proxies describe vercentlabs-https-proxy --global ||
    "${GC[@]}" compute target-https-proxies create vercentlabs-https-proxy --global --url-map=vercentlabs-https --ssl-certificates=vercentlabs-cert
  exists "${GC[@]}" compute forwarding-rules describe vercentlabs-https-rule --global ||
    "${GC[@]}" compute forwarding-rules create vercentlabs-https-rule --global --load-balancing-scheme=EXTERNAL_MANAGED \
      --address=vercentlabs-ip --target-https-proxy=vercentlabs-https-proxy --ports=443

  say "http:// redirects to https://"
  if ! exists "${GC[@]}" compute url-maps describe vercentlabs-http-redirect --global; then
    local redirect; redirect="$(mktemp)"
    printf 'name: vercentlabs-http-redirect\ndefaultUrlRedirect:\n  httpsRedirect: true\n  redirectResponseCode: MOVED_PERMANENTLY_DEFAULT\n' >"$redirect"
    "${GC[@]}" compute url-maps import vercentlabs-http-redirect --global --source="$redirect"
    rm -f "$redirect"
  fi
  exists "${GC[@]}" compute target-http-proxies describe vercentlabs-http-proxy --global ||
    "${GC[@]}" compute target-http-proxies create vercentlabs-http-proxy --global --url-map=vercentlabs-http-redirect
  exists "${GC[@]}" compute forwarding-rules describe vercentlabs-http-rule --global ||
    "${GC[@]}" compute forwarding-rules create vercentlabs-http-rule --global --load-balancing-scheme=EXTERNAL_MANAGED \
      --address=vercentlabs-ip --target-http-proxy=vercentlabs-http-proxy --ports=80

  cat <<EOF

== Add these DNS records at Hostinger (hPanel › Domains › $SITE_DOMAIN › DNS / Nameservers)
   Delete any existing A/AAAA/CNAME records for @, www and app first (keep MX and TXT: they carry your Hostinger email).

   Type  Name  Points to          TTL
   A     @     $ip     3600
   A     www   $ip     3600
   A     app   $ip     3600
EOF
}

status() {
  "${GC[@]}" run services list --region="$REGION" --format='table(metadata.name,status.url,status.latestReadyRevisionName)'
  echo "IP: $("${GC[@]}" compute addresses describe vercentlabs-ip --global --format='value(address)' 2>/dev/null || echo 'not created')"
  "${GC[@]}" compute ssl-certificates describe vercentlabs-cert --global --format='yaml(managed.status,managed.domainStatus)' 2>/dev/null || true
}

case "${1:-}" in
  setup) setup ;;
  release) release ;;
  build-local) build_local ;;
  network) network ;;
  all) setup; release; network ;;
  status) status ;;
  *) echo "Usage: $0 setup|release|build-local|network|all|status"; exit 1 ;;
esac
