"use client";

import { useEffect, useRef } from "react";
import { retryPendingReportCleanupAction } from "@/lib/actions/reports";

/**
 * Reintento oportunista de la cola de limpieza de PDFs huérfanos (R2). Antes lo hacía la página del alumno mientras se
 * renderizaba (un GET que además borraba objetos de Storage); ahora es una Server Action (POST) disparada una vez al
 * abrir la pestaña. Best-effort: nunca muestra nada ni rompe el historial si falla.
 */
export function ReportCleanupTrigger() {
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        await retryPendingReportCleanupAction();
      } catch {
        // Best-effort.
      }
    })();
  }, []);

  return null;
}
