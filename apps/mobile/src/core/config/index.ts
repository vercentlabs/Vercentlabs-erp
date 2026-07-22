import Constants from "expo-constants";
import { Platform } from "react-native";

function apiOrigin() {
  const configured = String(
    process.env.EXPO_PUBLIC_API_URL ||
      Constants.expoConfig?.extra?.apiUrl ||
      "",
  ).replace(/\/+$/, "");
  if (configured) {
    if (!/^https?:\/\//.test(configured)) {
      throw new Error("EXPO_PUBLIC_API_URL must be an absolute HTTP(S) URL.");
    }
    return configured;
  }
  if (__DEV__) {
    return Platform.OS === "android"
      ? "http://10.0.2.2:3001"
      : "http://localhost:3001";
  }
  throw new Error("EXPO_PUBLIC_API_URL is required for production builds.");
}

function webOrigin() {
  const configured = String(
    process.env.EXPO_PUBLIC_WEB_APP_URL ||
      Constants.expoConfig?.extra?.webAppUrl ||
      "",
  ).replace(/\/+$/, "");
  if (configured) {
    if (!/^https?:\/\//.test(configured)) {
      throw new Error("EXPO_PUBLIC_WEB_APP_URL must be an absolute HTTP(S) URL.");
    }
    return configured;
  }
  if (__DEV__) {
    return Platform.OS === "android"
      ? "http://10.0.2.2:3000"
      : "http://localhost:3000";
  }
  throw new Error("EXPO_PUBLIC_WEB_APP_URL is required for production builds.");
}

export const appConfig = Object.freeze({
  apiUrl: apiOrigin(),
  webAppUrl: webOrigin(),
  version: Constants.expoConfig?.version || "1.0.0",
});
