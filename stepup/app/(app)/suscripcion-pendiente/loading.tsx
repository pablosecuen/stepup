import { DestinationSkeleton } from "@/components/nav/destination-skeleton";

// Esqueleto de «Suscripción pendiente» mientras el servidor la prepara (registro único de pantallas: lib/nav/screens.ts).
export default function Loading() {
  return <DestinationSkeleton fallbackPath="/suscripcion-pendiente" />;
}
