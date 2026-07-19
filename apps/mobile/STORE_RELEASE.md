# Vercent ERP mobile release

Production builds require `EXPO_PUBLIC_API_URL` to reference the canonical HTTPS API origin. Android package and iOS bundle identifiers are `com.vercentlabs.erp`.

## Release gate

1. Run the workspace release gate, Expo Doctor, and Android/iOS export.
2. Exercise sign-in, refresh rotation, offline reads, queued writes, biometric relock, search, notifications, and sign-out on physical Android and iOS devices.
3. Complete privacy disclosures for encrypted customer data, diagnostics, authentication identifiers, and notification data.
4. Create signed builds with `eas build --profile production --platform all` and submit only after staged rollout approval.

The app never embeds production secrets. API credentials and signing material remain in the deployment and store credential systems.
