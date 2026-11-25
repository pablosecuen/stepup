"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import PrivateLink from "@/components/nav/private-link";
import { linkClass } from "@/components/ui/button";
import { isLimitedModeMessage } from "@/lib/errors/limited-mode-message";

/** Mínimo entre dos comprobaciones seguidas del estado de acceso al volver a la pestaña (evita pedirle al servidor en cada foco). */
const RECHECK_MIN_MS = 10_000;

/**
 * Se muestra junto al mensaje breve de modo limitado cuando una escritura fue bloqueada: el acceso a Facturación y, además, una actualización SUAVE del estado
 * de acceso de la página (`router.refresh`: vuelve a pedir lo que muestra el servidor, como el aviso del encabezado, sin recargar la página ni perder lo que
 * hay escrito en los formularios). Así, si la cuenta venció con la página abierta, el aviso aparece sin recargar.
 */
export function LimitedModeAction() {
  const router = useRouter();
  useEffect(() => {
    router.refresh();
  }, [router]);
  return (
    <PrivateLink href="/suscripcion-pendiente" className={`${linkClass()} mt-1 block w-fit`}>
      Resolver el pago
    </PrivateLink>
  );
}

/**
 * Vive dentro del aviso de modo limitado del encabezado: mientras la cuenta está limitada, al volver a esta pestaña (por ejemplo después de pagar en otra) se
 * actualiza el estado de acceso sin recargar la página ni perder lo escrito. El reintento de guardar siempre lo decide el servidor en el momento.
 */
export function AccessRecoveryWatcher() {
  const router = useRouter();
  useEffect(() => {
    let last = Date.now();
    const recheck = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - last < RECHECK_MIN_MS) return;
      last = now;
      router.refresh();
    };
    document.addEventListener("visibilitychange", recheck);
    window.addEventListener("focus", recheck);
    return () => {
      document.removeEventListener("visibilitychange", recheck);
      window.removeEventListener("focus", recheck);
    };
  }, [router]);
  return null;
}

/**
 * El pago se confirmó mientras la persona estaba en «Suscripción pendiente»: la actualización suave del estado ya trae la cuenta sin bloqueo, y esto la lleva de vuelta a Inicio SIN
 * cerrar sesión ni recargar (un `redirect` del servidor no navega durante una actualización suave del cliente).
 */
export function AccessRestoredRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/inicio");
  }, [router]);
  return null;
}

/** Para los avisos de error que no usan `Notice`: agrega el acceso a Facturación sólo si el mensaje es el del modo limitado. */
export function LimitedModeFollowUp({ message }: { message: unknown }) {
  return isLimitedModeMessage(message) ? <LimitedModeAction /> : null;
}
