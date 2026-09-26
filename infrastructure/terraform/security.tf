# Cloud Armor edge policy for the external HTTPS load balancer (attached to
# the web and landing backends through the GKE BackendConfig in the
# Kubernetes overlay). Conservative baseline: default allow, per-IP
# throttling of anonymous authentication endpoints, preconfigured WAF rules
# in PREVIEW (log-only) until their logs are reviewed against real traffic.
# Application rate limits and CSRF/origin checks remain in force; this is an
# additional layer, not a replacement.

resource "google_compute_security_policy" "edge" {
  name        = "${local.name}-edge"
  description = "Vercentlabs ERP edge policy"
  type        = "CLOUD_ARMOR"

  advanced_options_config {
    log_level    = "VERBOSE"
    json_parsing = "STANDARD"
  }

  # Anonymous authentication endpoints: throttle per client IP.
  rule {
    priority    = 1000
    action      = "throttle"
    description = "Throttle anonymous authentication endpoints per IP"
    match {
      expr {
        expression = "request.path.startsWith('/api/auth/')"
      }
    }
    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      enforce_on_key = "IP"
      rate_limit_threshold {
        count        = var.armor_auth_rate_limit_per_minute
        interval_sec = 60
      }
    }
  }

  # Public token endpoints (quotation links, meeting bookings): throttle to
  # blunt token guessing; tokens are 32 random bytes regardless.
  rule {
    priority    = 1100
    action      = "throttle"
    description = "Throttle public token endpoints per IP"
    match {
      expr {
        expression = "request.path.matches('/api/(crm|sales)/public/.*')"
      }
    }
    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      enforce_on_key = "IP"
      rate_limit_threshold {
        count        = 60
        interval_sec = 60
      }
    }
  }

  # Test-support endpoints must never be reachable from the internet (the
  # application also refuses them in production).
  rule {
    priority    = 1200
    action      = "deny(404)"
    description = "Block test-support endpoints at the edge"
    match {
      expr {
        expression = "request.path.startsWith('/api/test-support/')"
      }
    }
  }

  # OWASP preconfigured rules (sensitivity 1 = fewest false positives).
  dynamic "rule" {
    for_each = {
      2000 = "sqli-v33-stable"
      2010 = "xss-v33-stable"
      2020 = "lfi-v33-stable"
      2030 = "rce-v33-stable"
      2040 = "scannerdetection-v33-stable"
      2050 = "protocolattack-v33-stable"
    }
    content {
      priority    = rule.key
      action      = "deny(403)"
      preview     = var.armor_waf_preview
      description = "Preconfigured WAF: ${rule.value}"
      match {
        expr {
          expression = "evaluatePreconfiguredWaf('${rule.value}', {'sensitivity': 1})"
        }
      }
    }
  }

  rule {
    priority    = 2147483647
    action      = "allow"
    description = "Default allow"
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
  }
}

# Google-managed certificate for the public hostnames (the Ingress in the
# Kubernetes overlay references it through a ManagedCertificate resource).
# DNS A/AAAA records at the registrar point the hostnames to
# google_compute_global_address.ingress (see terraform/README.md).

# TLS 1.2+ with the MODERN profile for the HTTPS load balancer (the
# Kubernetes FrontendConfig references it by name).
resource "google_compute_ssl_policy" "tls" {
  name            = "${local.name}-tls"
  profile         = "MODERN"
  min_tls_version = "TLS_1_2"
}
