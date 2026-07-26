import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import * as Device from "expo-device";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const installationKey = "vercentlabs.mobile.installation-id.v1";

async function installationId() {
  const stored = await SecureStore.getItemAsync(installationKey);
  if (stored) return stored;
  const created = Crypto.randomUUID();
  await SecureStore.setItemAsync(installationKey, created, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return created;
}

export async function deviceContext() {
  if (Platform.OS !== "ios" && Platform.OS !== "android") {
    throw new Error("Vercentlabs ERP Mobile supports iOS and Android devices.");
  }
  return {
    deviceId: await installationId(),
    platform: Platform.OS,
    deviceName:
      [Device.manufacturer, Device.modelName].filter(Boolean).join(" ") ||
      "Mobile device",
    appVersion: Constants.expoConfig?.version || "1.0.0",
  } as const;
}
