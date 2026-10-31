"use client";

import {useSyncExternalStore} from "react";
import {usePathname} from "next/navigation";
import {RouteSkeleton} from "@/components/nav/screen-skeleton";
import {getPendingNavigation, readSharedName, subscribePendingNavigation} from "@/lib/nav/pending-destination";
import {pathnameOf, resolveScreen} from "@/lib/nav/screens";

/** A parent loading boundary also catches its nested routes: never show the list skeleton while opening a profile. */
export function DestinationSkeleton({fallbackPath}:{fallbackPath:string}) {
  const pathname=usePathname();
  const pending=useSyncExternalStore(subscribePendingNavigation,getPendingNavigation,()=>null);
  const candidate=pathnameOf(pending?.destination ?? pathname);
  // El nombre compartido del clic sólo vale para SU destino (nunca para otra pantalla que casualmente cargue antes).
  return <RouteSkeleton path={resolveScreen(candidate) ? candidate : fallbackPath} sharedName={readSharedName(candidate)} />;
}
