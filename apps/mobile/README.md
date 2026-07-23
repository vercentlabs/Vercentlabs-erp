# Vercent ERP Mobile

The native Vercent ERP workspace for Android and iOS. It mirrors the protected
responsive-web experience across the organisation dashboard, CRM, master data,
administration, approvals, billing, audit, profile and security. It is built
with Expo SDK 57, Expo Router, strict TypeScript and the versioned
`/api/mobile/v1` contract.

## Local setup

1. Use Node 24 and pnpm 11.13.0.
2. Copy `.env.example` to `.env.local` and set the public API origin.
3. Run `pnpm dev:mobile` from the repository root.
4. Use a development build for encrypted SQLite, Face ID, Razorpay and other
   native modules. Expo Go is not a supported runtime.

Razorpay `3.0.0` is intentionally excluded from Expo Doctor's React Native
Directory metadata check. That directory entry still reports the package as
old-architecture-only, while the pinned official release ships codegen config,
TurboModule specifications and new-architecture Android/iOS implementations.
Do not remove the pin or the exclusion without re-running a clean native build
and checkout on both platforms.

The mobile app may import shared packages, but must never import from `apps/web`
or `services/api` directly.

## Native project policy

`android/` and `ios/` are generated locally from `app.config.ts` and the Expo
config plugins. The Android and iOS scripts always run Expo Prebuild before a
native build so checked-in or cached native files cannot silently drift from
the application configuration.

## Session and offline boundary

The app uses one authenticated API client. Offline SQLite data and queued
mutations are bound to the signed-in user and organization and are purged when
that boundary changes. Connectivity listeners flush writes only while a valid
session is active.

## Web parity

`docs/mobile-web-parity.md` is the release contract. The mobile parity test
scans every protected web page family, checks that it has a native destination
and verifies the native shell, APIs and high-value actions. Authentication
links that require email tokens or CAPTCHA open the responsive web flow in the
system browser; protected workspace pages never use a WebView.
