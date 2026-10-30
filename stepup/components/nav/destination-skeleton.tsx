"use client";

import {useSyncExternalStore} from "react";
import {usePathname} from "next/navigation";
import {RouteSkeleton} from "@/components/nav/screen-skeleton";
import {getPendingNavigation, subscribePendingNavigation} from "@/lib/nav/pending-destination";
import {pathnameOf, resolveScreen} from "@/lib/nav/screens";

/** A parent loading boundary also catches its nested routes: never show the list skeleton while opening a profile. */
export function DestinationSkeleton({fallbackPath}:{fallbackPath:string}) {
  const pathname=usePathname();
  const pending=useSyncExternalStore(subscribePendingNavigation,getPendingNavigation,()=>null);
  const candidate=pathnameOf(pending?.destination ?? pathname);
  return <RouteSkeleton path={resolveScreen(candidate) ? candidate : fallbackPath} />;
}
