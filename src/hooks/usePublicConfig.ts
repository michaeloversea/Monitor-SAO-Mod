import { getPublic } from "@/services/api";
import type { PublicConfig } from "@/types/theme";
import { useQuery } from "@tanstack/react-query";

export function usePublicConfig() {
  return useQuery<PublicConfig>({
    queryKey: ["public"],
    queryFn: ({ signal }) => getPublic({ signal }),
    staleTime: 60_000,
  });
}
