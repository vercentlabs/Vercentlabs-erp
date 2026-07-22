# Vercent ERP mobile architecture

The application is a native Expo/React Native client. It does not use a WebView as feature parity.

- `src/app`: route composition only.
- `src/core`: authentication, API, encrypted database, permissions, security and providers.
- `src/modules`: independently owned ERP modules. CRM is the released reference module.
- `src/shared`: design system and cross-module UI.
- `src/testing`: shared test utilities.

An ERP module owns its manifest, screens, components, hooks, API/data adapters, offline handlers and tests. Unreleased modules are not represented as working native features. They are added only when backend contracts and permission enforcement exist.
