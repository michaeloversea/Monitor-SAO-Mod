import { useMinuteClock } from "@/hooks/useClock";
import type { PingOverviewItem } from "@/types/theme";
import { buildFakePingItem } from "@/utils/fakePing";
import {
  invertHomepagePingTaskBindings,
  type HomepagePingTaskBindings,
} from "@/utils/pingTasks";
import { useMemo } from "react";

export function useFakePingFallback(
  uuid: string,
  ping: PingOverviewItem,
  isOnline: boolean,
  fakePingForUnbound: boolean,
  homepagePingBindings: HomepagePingTaskBindings,
): PingOverviewItem {
  const boundUuids = useMemo(
    () =>
      fakePingForUnbound
        ? invertHomepagePingTaskBindings(homepagePingBindings)
        : null,
    [fakePingForUnbound, homepagePingBindings],
  );

  const shouldFake =
    isOnline &&
    boundUuids != null &&
    !boundUuids.has(uuid) &&
    !ping.isAssigned;

  const minuteIndex = Math.floor(useMinuteClock(shouldFake) / 60_000);

  return useMemo(
    () => (shouldFake ? buildFakePingItem(uuid, minuteIndex) : ping),
    [shouldFake, uuid, minuteIndex, ping],
  );
}
