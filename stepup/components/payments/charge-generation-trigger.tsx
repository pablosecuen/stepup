"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ensureCurrentChargesAction } from "@/lib/actions/payments";

/**
 * Genera las mensualidades y cuotas de entrenamiento faltantes del período vigente DESPUÉS de mostrar la pantalla (R2).
 *
 * Antes lo hacían las propias páginas (`/inicio`, `/cobros`, `/recordatorios`, pestaña Cobros del alumno) mientras se
 * renderizaban: un GET escribía datos, y cualquier precarga, escáner o navegación cruzada podía dispararlo. Ahora la
 * escritura es una Server Action (POST): una solicitud de lectura jamás escribe. Es la misma operación idempotente de
 * siempre (clave natural en la base: nunca duplica) y el servidor calcula el período — este componente no envía datos.
 *
 * Si se creó algo, refresca la pantalla para que lo muestre; si no (lo habitual), no hace nada visible. Un fallo (red o
 * servidor) no rompe la pantalla: los datos ya cargados siguen ahí y la próxima visita lo reintenta.
 */
export function ChargeGenerationTrigger() {
  const router = useRouter();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        const result = await ensureCurrentChargesAction();
        if ("data" in result && result.data && result.data.created > 0) router.refresh();
      } catch {
        // Silencioso a propósito: es una tarea de fondo idempotente; se reintenta en la próxima visita.
      }
    })();
  }, [router]);

  return null;
}
