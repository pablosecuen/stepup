"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { checkSessionReadyAction } from "@/lib/auth/session-recovery-action";
import { SESSION_RECOVERED_DESTINATION, runSessionRecovery } from "@/lib/auth/session-recovery";

/**
 * Pantalla transitoria mientras PostgREST todavía no reconoce el token recién emitido ("JWT issued at future").
 * Sin navegación privada y sin enlaces (nada que precargar). Corre `runSessionRecovery` UNA vez por intento del
 * usuario: espera con backoff, comprueba en el servidor con consultas de sólo lectura y, si todo pasa, entra a Inicio.
 * Si el límite se agota muestra el error normal con acciones claras; nunca vuelve a empezar sola.
 */
export function SessionRecovery({ signOutForm }: { signOutForm: ReactNode }) {
  const router = useRouter();
  const [exhausted, setExhausted] = useState(false);
  const [run, setRun] = useState(0);

  useEffect(() => {
    let cancelled = false;
    runSessionRecovery({
      check: (attempt) => checkSessionReadyAction(attempt),
      sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
      isCancelled: () => cancelled,
    }).then((outcome) => {
      if (cancelled) return;
      // "ready": Inicio carga. "other_error": el error ya no es este caso; Inicio lo muestra tal cual (sin volver a esta pantalla).
      if (outcome.kind === "ready" || outcome.kind === "other_error") router.replace(SESSION_RECOVERED_DESTINATION);
      else if (outcome.kind === "signed_out") router.replace("/login");
      else if (outcome.kind === "exhausted") setExhausted(true);
    });
    return () => {
      cancelled = true;
    };
  }, [run, router]);

  if (exhausted) {
    return (
      <div role="alert" className="flex flex-col gap-4 text-center">
        <p className="text-[15px] font-bold text-bad">No pudimos cargar Inicio.</p>
        <p className="text-sm text-textSecondary">Tu sesión se inició, pero el servidor todavía no la reconoce. Probá de nuevo en unos segundos.</p>
        <Button
          onClick={() => {
            setExhausted(false);
            setRun((current) => current + 1);
          }}
        >
          Reintentar
        </Button>
        {signOutForm}
      </div>
    );
  }

  return (
    <div role="status" aria-live="polite" className="flex flex-col items-center gap-3 text-center">
      <span aria-hidden className="h-7 w-7 animate-spin rounded-full border-[3px] border-accentSoft border-t-accent motion-reduce:animate-none" />
      <p className="text-[15px] font-bold text-textPrimary">Estamos terminando de iniciar tu sesión…</p>
      <p className="text-[13.5px] text-textMuted">Esto tarda unos segundos. No cierres esta ventana.</p>
    </div>
  );
}
