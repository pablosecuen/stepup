"use client";

import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type ComponentProps, type FocusEvent, type PointerEvent } from "react";
import { intentPathname, isStudentProfilePathname, shouldPrefetchOnIntent } from "@/lib/nav/intent-prefetch";

/**
 * `next/link` SIN precarga automática, para toda ruta del área privada. Por defecto Next precarga cada `<Link>` que entra al
 * viewport (y el layout privado es dinámico: cada precarga vuelve a ejecutar su verificación de sesión): con una sesión
 * recién creada eso dispara ráfagas de consultas (B0, "JWT issued at future"). `prefetch={false}` no precarga ni al entrar
 * al viewport ni al pasar el mouse (docs de Next 16). El prop no se puede reactivar desde afuera.
 *
 * Sólo se precarga por INTENCIÓN, nunca toda la lista. Una sección frecuente descarga su estructura; la ficha concreta señalada por la persona
 * descarga sus datos para que el nombre pueda viajar en el mismo relevo. Conserva el límite de 3 s tras el acceso y respeta ahorro de datos.
 */
export type PrivateLinkProps = Omit<ComponentProps<typeof NextLink>, "prefetch">;

export default function PrivateLink({ onPointerEnter, onPointerDown, onFocus, ...props }: PrivateLinkProps) {
  const router = useRouter();
  const lastPrefetchAt = useRef<number | null>(null);
  const [profilePrefetchHref, setProfilePrefetchHref] = useState<string | null>(null);

  function prefetchOnIntent() {
    const href = props.href;
    const now = Date.now();
    const saveData = typeof navigator !== "undefined" && (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
    if (!shouldPrefetchOnIntent({ href, pageAgeMs: performance.now(), nowMs: now, lastPrefetchAtMs: lastPrefetchAt.current, saveData })) return;
    lastPrefetchAt.current = now;
    const pathname = intentPathname(href);
    if (typeof href === "string" && pathname && isStudentProfilePathname(pathname)) {
      setProfilePrefetchHref(href);
      return;
    }
    router.prefetch(href as string);
  }

  return (
    <NextLink
      {...props}
      transitionTypes={["tf-navigation"]}
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
      prefetch={profilePrefetchHref !== null && profilePrefetchHref === props.href}
    />
  );
}
