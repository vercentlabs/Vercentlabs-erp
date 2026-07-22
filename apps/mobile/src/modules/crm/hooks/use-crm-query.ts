import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { readCache, writeCache } from "@/core/database/database";

export function useCrmQuery<T>(key: string, loader: () => Promise<T>) {
  const [cached, setCached] = useState<{ key: string; data: T } | null>(null);
  useEffect(() => {
    let active = true;
    void readCache<T>(key).then((entry) => {
      if (active && entry) setCached({ key, data: entry.data });
    });
    return () => {
      active = false;
    };
  }, [key]);
  const query = useQuery({
    queryKey: ["mobile-crm", key],
    queryFn: async () => {
      const data = await loader();
      await writeCache(key, "crm", data);
      return data;
    },
  });
  const cachedData = cached?.key === key ? cached.data : undefined;
  return {
    ...query,
    data: query.data ?? cachedData,
    isOfflineFallback: !query.data && Boolean(cachedData),
  };
}
