"use client";

import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { useRef, type ComponentProps, type FocusEvent, type PointerEvent } from "react";
import { shouldPrefetchOnIntent } from "@/lib/nav/intent-prefetch";

/**
 * `next/link` SIN precarga automática, para toda ruta del área privada. Por defecto Next precarga cada `<Link>` que entra al
 * viewport (y el layout privado es dinámico: cada precarga vuelve a ejecutar su verificación de sesión): con una sesión
 * recién creada eso dispara ráfagas de consultas (B0, "JWT issued at future"). `prefetch={false}` no precarga ni al entrar
 * al viewport ni al pasar el mouse (docs de Next 16). El prop no se puede reactivar desde afuera.
 *
 * La única precarga permitida es la de INTENCIÓN (`lib/nav/intent-prefetch.ts`): al posar el puntero o enfocar con el teclado un enlace
 * de una ruta frecuente se descarga su esqueleto, una vez por destino y nunca en los primeros segundos de la página.
 */
export type PrivateLinkProps = Omit<ComponentProps<typeof NextLink>, "prefetch">;

export default function PrivateLink({ onPointerEnter, onPointerDown, onFocus, ...props }: PrivateLinkProps) {
  const router = useRouter();
  const lastPrefetchAt = useRef<number | null>(null);

  function prefetchOnIntent() {
    const href = props.href;
    const now = Date.now();
    const saveData = typeof navigator !== "undefined" && (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
    if (!shouldPrefetchOnIntent({ href, pageAgeMs: performance.now(), nowMs: now, lastPrefetchAtMs: lastPrefetchAt.current, saveData })) return;
    lastPrefetchAt.current = now;
    router.prefetch(href as string);
  }

  return (
    <NextLink
      {...props}
      onPointerEnter={(event: PointerEvent<HTMLAnchorElement>) => {
        onPointerEnter?.(event);
        if (event.pointerType === "mouse") prefetchOnIntent();
      }}
      onPointerDown={(event: PointerEvent<HTMLAnchorElement>) => {
        onPointerDown?.(event);
        prefetchOnIntent(); // el dedo (o el botón) ya está sobre el enlace: el esqueleto se descarga mientras dura el toque
      }}
      onFocus={(event: FocusEvent<HTMLAnchorElement>) => {
        onFocus?.(event);
        if (event.currentTarget.matches(":focus-visible")) prefetchOnIntent();
      }}
      prefetch={false}
    />
  );
}
