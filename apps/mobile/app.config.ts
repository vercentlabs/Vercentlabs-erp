import type { ExpoConfig, ConfigContext } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Vercent ERP",
  slug: "vercent-erp",
  version: "1.0.0",
  runtimeVersion: { policy: "appVersion" },
  orientation: "default",
  icon: "./assets/app-icon.png",
  userInterfaceStyle: "light",
  scheme: "vercent",
  platforms: ["ios", "android"],
  ios: {
    bundleIdentifier: "com.vercentlabs.erp",
    supportsTablet: true,
    config: { usesNonExemptEncryption: false },
    infoPlist: {
      NSFaceIDUsageDescription:
        "Use Face ID to unlock your secure Vercent ERP workspace.",
      LSApplicationQueriesSchemes: ["tez", "phonepe", "paytmmp"],
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
  androidStatusBar: {
    backgroundColor: "#FFFFFF",
    barStyle: "dark-content",
  },
  plugins: [
    "expo-router",
    [
      "expo-secure-store",
      {
        configureAndroidBackup: false,
        faceIDPermission:
          "Use Face ID to unlock your secure Vercent ERP workspace.",
      },
    ],
    "./plugins/with-android-stl-compat",
    "./plugins/with-disable-android-backup",
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
        backgroundColor: "#F4F6FA",
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
