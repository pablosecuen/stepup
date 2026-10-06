"use client";

import { RouteErrorView } from "@/components/ui/route-error";

// Error de las pantallas públicas (login, landing…) y de cualquier error del layout raíz. Dentro del área privada
// el error se captura más abajo (`app/(app)/error.tsx`), sin perder la navegación.
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteErrorView error={error} reset={reset} homeHref="/" homeLabel="Ir al inicio" inShell={false} />;
}
