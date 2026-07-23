import { useLocalSearchParams } from "expo-router";

import { ResourceManagerScreen } from "@/shared/components/resource-manager-screen";

export default function WorkspaceResourceRoute() {
  const { area = "", resource = "", create } = useLocalSearchParams<{
    area: string;
    resource: string;
    create?: string;
  }>();
  return <ResourceManagerScreen area={area} resource={resource} startCreating={create === "1"} />;
}
