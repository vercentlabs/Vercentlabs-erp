import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { readCache, writeCache } from "@/core/database/database";

export function useCrmQuery<T>(key: string, loader: () => Promise<T>) {
  const [cached, setCached] = useState<T | undefined>();
  useEffect(() => { void readCache<T>(key).then((entry) => setCached(entry?.data)); }, [key]);
  const query = useQuery({
    queryKey: ["mobile-crm", key],
    queryFn: async () => {
      const data = await loader();
      await writeCache(key, "crm", data);
      return data;
    },
  });
  return { ...query, data: query.data ?? cached, isOfflineFallback: !query.data && Boolean(cached) };
}
