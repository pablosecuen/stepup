"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { formatCount, formatMoney, formatHours, formatPercent } from "@/lib/format/number-format";
import { createBrowserCountEnv, runCountAnimation, type CountKind } from "@/lib/ui/count-animation";

const formats: Record<CountKind, (value: number) => string> = { money: formatMoney, count: formatCount, hours: formatHours, percent: formatPercent };

/**
 * Contador compartido (Finanzas, resumen, presupuesto). El texto que se ve y el accesible son SIEMPRE el valor final
 * recibido; sólo mientras corre la animación el texto visible muestra un valor intermedio, y es el único que se
 * descarta al terminar. La lógica de visibilidad/animación está en `lib/ui/count-animation.ts`.
 */
export function AnimatedNumber({ value, kind = "money" }: { value: number; kind?: CountKind }) {
  const root = useRef<HTMLSpanElement>(null);
  const shown = useRef<number | null>(null); // lo que hay en pantalla ahora (para continuar desde ahí si el valor cambia)
  const plan = useRef<{ to: number; from: number } | null>(null);
  const [frame, setFrame] = useState<{ key: string; value: number } | null>(null);
  const key = `${kind}:${value}`;
  const text = formats[kind](value);
  // Un valor intermedio sólo cuenta si pertenece a ESTA animación; cualquier otro caso muestra el valor recibido.
  const visible = frame && frame.key === key ? formats[kind](frame.value) : text;

  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    // Primera entrada: desde 0. Si el valor cambia después: desde lo que se estaba mostrando (o desde el último valor
    // asentado si la animación nunca llegó a correr porque el contador no se vio). Repetir el efecto con el MISMO valor
    // (ensayo doble de React en desarrollo) conserva el mismo origen en vez de tomar el destino como punto de partida.
    const from = plan.current && plan.current.to === value ? plan.current.from : shown.current ?? plan.current?.to ?? 0;
    plan.current = { to: value, from };
    const run = runCountAnimation({
      from,
      to: value,
      kind,
      env: createBrowserCountEnv(element),
      emit: (current, final) => {
        shown.current = current;
        setFrame(final ? null : { key, value: current });
      },
    });
    return run.dispose;
  }, [key, kind, value]);

  return <span ref={root} className="inline-grid whitespace-nowrap align-baseline tf-num">
    <span aria-hidden="true" className="invisible col-start-1 row-start-1">{text}</span>
    <span aria-hidden="true" className="col-start-1 row-start-1" data-count-visible>{visible}</span>
    <span className="sr-only">{text}</span>
  </span>;
}
