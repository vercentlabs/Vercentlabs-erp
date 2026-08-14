# Vercentlabs Workspace email directory

This directory is the canonical ownership map for `@vercentlabs.com`
addresses used by the marketing site, ERP platform, deployment providers, and
company operations. Passwords, app passwords, recovery codes, and provider
tokens must never be stored in this repository.

## Licensed accounts

| Address | Owner | Use |
| --- | --- | --- |
| `atharva.chavan@vercentlabs.com` | Atharva Chavan | Named human account and Workspace administration. Do not use for automated delivery. |
| `auth@vercentlabs.com` | Platform operations | Authentication SMTP identity for verification, reset, invitation, and future OTP messages. |

Every additional team member receives a named account. Shared passwords are
not permitted.

## Customer-facing groups

| Address | Responsibility | Public surface |
| --- | --- | --- |
| `sales@vercentlabs.com` | Demo requests and commercial enquiries | Landing footer and organization metadata |
| `support@vercentlabs.com` | Product support and authentication replies | Landing footer, Privacy Policy, Terms of Use |
| `privacy@vercentlabs.com` | Data-subject and privacy requests | Landing footer and Privacy Policy |
| `security@vercentlabs.com` | Vulnerability and security reports | Landing footer and organization metadata |
| `careers@vercentlabs.com` | Recruitment enquiries | Landing footer |
| `billing@vercentlabs.com` | Subscription, invoice, and payment enquiries | Landing footer |

Groups must accept messages from external senders. Members must reply from the
role address when representing the company, not from a shared login.

## Internal operational groups

| Address | Responsibility |
| --- | --- |
| `operations@vercentlabs.com` | Hostinger, database, uptime, deployment, certificate, GitHub, and provider alerts |
| `dmarc@vercentlabs.com` | Aggregate DMARC reports and mail-authentication monitoring |

These addresses are intentionally absent from public landing content.

## Authentication delivery contract

The ERP web application uses:

```dotenv
SMTP_USER=auth@vercentlabs.com
AUTH_EMAIL_FROM="Vercentlabs Security <auth@vercentlabs.com>"
AUTH_EMAIL_REPLY_TO=support@vercentlabs.com
```

The SMTP password is supplied only through the deployment environment. The
same visible identity must be retained if delivery moves from Google SMTP to
the existing authentication-email webhook contract.

## Alias policy

Route `hello@`, `contact@`, and `info@` to Sales. Route `career@` and the
existing misspelling `carrer@` to Careers. Route `abuse@` to Security and
`postmaster@` plus `alerts@` to Operations. Aliases do not receive credentials.

## DNS gate

Before production authentication delivery is enabled, the domain must have
one complete SPF policy covering every real sender, Google Workspace DKIM must
be active, and DMARC reports must reach `dmarc@vercentlabs.com`. Do not create
multiple SPF TXT records.
