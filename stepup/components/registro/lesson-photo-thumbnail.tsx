"use client";

import { useEffect, useRef, useState } from "react";

/* eslint-disable react-hooks/set-state-in-effect -- la miniatura se pide al entrar en pantalla: el estado cambia al empezar y terminar el pedido */

type Phase = { state: "idle" } | { state: "loading" } | { state: "ready"; url: string } | { state: "unreadable" } | { state: "error" };

/**
 * Miniatura de una foto adjunta (selección de evidencias del reporte y filas de fotos de la clase). La hace el servidor (`?miniatura=1`, también para HEIC) y sólo se pide cuando la fila entra en pantalla.
 * Distingue tres resultados: la miniatura; «no se puede leer» (el servidor responde 422: un HEIC inválido o una imagen dañada, que tampoco abriría ni entraría en un reporte) y un error pasajero
 * (red o servidor), que NO marca la foto como inutilizable y permite reintentar. `onUnreadable` avisa a quien la muestra para que no la presente como una foto utilizable.
 */
export function LessonPhotoThumbnail({ id, name, sizePx = 56, onUnreadable }: { id: string; name: string; sizePx?: number; onUnreadable?: (id: string) => void }) {
  const [phase, setPhase] = useState<Phase>({ state: "idle" });
  const [attempt, setAttempt] = useState(0);
  const box = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const notify = useRef(onUnreadable);
  useEffect(() => {
    notify.current = onUnreadable;
  });

  useEffect(() => {
    const element = box.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    setPhase({ state: "loading" });
    (async () => {
      try {
        const response = await fetch(`/api/archivos/adjunto/${encodeURIComponent(id)}?miniatura=1`, { credentials: "same-origin", cache: "no-store" });
        if (response.status === 422) {
          if (!cancelled) {
            setPhase({ state: "unreadable" });
            notify.current?.(id);
          }
          return;
        }
        if (!response.ok) throw new Error("fetch");
        objectUrl = URL.createObjectURL(await response.blob());
        if (cancelled) URL.revokeObjectURL(objectUrl);
        else setPhase({ state: "ready", url: objectUrl });
      } catch {
        if (!cancelled) setPhase({ state: "error" });
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, visible, attempt]);

  const style = { width: sizePx, height: sizePx };
  const frame = "flex shrink-0 items-center justify-center rounded-md border border-borderMid bg-surface2 px-1 text-center text-[10px] font-semibold leading-tight text-textMuted";
  return (
    <span ref={box} className="shrink-0" style={style}>
      {phase.state === "ready" ? (
        // eslint-disable-next-line @next/next/no-img-element -- miniatura privada de la sesión (blob: local); next/image no aplica
        <img src={phase.url} alt={`Miniatura de ${name}`} width={sizePx} height={sizePx} className="rounded-md border border-borderMid bg-surface2 object-cover" style={style} data-testid="miniatura" />
      ) : phase.state === "unreadable" ? (
        <span className={`${frame} !border-bad !text-bad`} style={style} data-testid="miniatura-ilegible" role="img" aria-label={`${name}: no se puede abrir como foto`}>
          No se puede leer
        </span>
      ) : phase.state === "error" ? (
        <button type="button" className={`${frame} cursor-pointer`} style={style} onClick={() => setAttempt((n) => n + 1)} data-testid="miniatura-reintentar" aria-label={`Reintentar la miniatura de ${name}`}>
          Reintentar
        </button>
      ) : (
        <span className={frame} style={style} aria-hidden>
          …
        </span>
      )}
    </span>
  );
}
