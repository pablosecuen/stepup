"use client";

import { RouteErrorView } from "@/components/ui/route-error";

// Error dentro del área privada: se captura DEBAJO del shell, así la navegación (barra lateral / inferior) y el menú de
// cuenta siguen disponibles y se puede salir del error sin recargar toda la página.
export default function PrivateRouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteErrorView error={error} reset={reset} homeHref="/inicio" homeLabel="Ir a Inicio" inShell />;
}
