import type { ExpoConfig, ConfigContext } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Vercent ERP",
  slug: "vercent-erp",
  version: "1.0.0",
  runtimeVersion: { policy: "appVersion" },
  orientation: "default",
  icon: "./assets/app-icon.png",
  userInterfaceStyle: "automatic",
  scheme: "vercent",
  platforms: ["ios", "android"],
  ios: {
    bundleIdentifier: "com.vercentlabs.erp",
    supportsTablet: true,
    config: { usesNonExemptEncryption: false },
    infoPlist: {
      NSFaceIDUsageDescription:
        "Use Face ID to unlock your secure Vercent ERP workspace.",
    },
  },
  android: {
    package: "com.vercentlabs.erp",
    adaptiveIcon: {
      foregroundImage: "./assets/app-icon.png",
      backgroundColor: "#FFFFFF",
    },
    predictiveBackGestureEnabled: true,
    permissions: ["USE_BIOMETRIC"],
  },
  plugins: [
    "expo-router",
    [
      "expo-secure-store",
      {
        configureAndroidBackup: true,
        faceIDPermission:
          "Use Face ID to unlock your secure Vercent ERP workspace.",
      },
    ],
    ["expo-sqlite", { useSQLCipher: true, enableFTS: true }],
    "./plugins/with-openssl-android",
    [
      "expo-local-authentication",
      {
        faceIDPermission:
          "Use Face ID to unlock your secure Vercent ERP workspace.",
      },
    ],
    [
      "expo-splash-screen",
      {
        backgroundColor: "#0B1220",
        image: "./assets/splash-icon.png",
        imageWidth: 160,
      },
    ],
  ],
  experiments: { typedRoutes: true },
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL || "",
    webAppUrl: process.env.EXPO_PUBLIC_WEB_APP_URL || "",
  },
});
