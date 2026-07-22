import type { ComponentProps } from "react";
import type { Ionicons } from "@expo/vector-icons";

export type NativeModuleManifest = {
  key: string;
  name: string;
  description: string;
  icon: ComponentProps<typeof Ionicons>["name"];
  permission?: string;
  released: boolean;
  routes: readonly string[];
  offline: { resources: readonly string[]; mutationHandlers: readonly string[] };
};
