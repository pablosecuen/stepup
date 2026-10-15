"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import { Monitor } from "@/components/landing/frame";
import { ScreenInicio } from "@/components/landing/screens";

// Sólo Inicio viaja en el HTML inicial; las demás pantallas son fragmentos aparte que se piden al elegirlas (o cuando el navegador queda libre).
const loaders = {
  calendario: () => import("@/components/landing/tour-screens").then((m) => m.TourCalendario),
  perfil: () => import("@/components/landing/tour-screens").then((m) => m.TourPerfil),
  cobros: () => import("@/components/landing/tour-screens").then((m) => m.TourCobros),
  resumen: () => import("@/components/landing/tour-screens").then((m) => m.TourResumen),
};
const Calendario = dynamic(loaders.calendario, { ssr: false, loading: () => <Pending /> });
const Perfil = dynamic(loaders.perfil, { ssr: false, loading: () => <Pending /> });
const Cobros = dynamic(loaders.cobros, { ssr: false, loading: () => <Pending /> });
const Resumen = dynamic(loaders.resumen, { ssr: false, loading: () => <Pending /> });

function Pending() {
  return <div className="min-h-[420px] rounded-[20px] bg-sideActive" aria-hidden />;
}

function TourScreen({ id }: { id: string }) {
  if (id === "inicio") return <Monitor path="inicio"><ScreenInicio /></Monitor>;
  if (id === "calendario") return <Calendario />;
  if (id === "perfil") return <Perfil />;
  if (id === "cobros") return <Cobros />;
  return <Resumen />;
}

export interface TourItem {
  key: string;
  label: string;
  title: string;
  text: string;
  /** Descripción en texto de la pantalla demostrativa (la maqueta es una sola imagen para lectores de pantalla). */
  alt: string;
}

/**
 * Recorrido interactivo: la computadora permanece y la persona elige la pantalla (pestañas accesibles con flechas, Inicio y Fin, y
 * botones Anterior / Siguiente). Sólo Inicio llega en el HTML; las demás se piden al elegirlas (o al acercarse a la sección). Sólo se muestra la elegida, con un
 * cambio suave de 260 ms (sin movimiento con «reducir movimiento»). No es un video: nada avanza solo.
 */
export function Tour({ items }: { items: readonly TourItem[] }) {
  const [active, setActive] = useState(0);
  const [seen, setSeen] = useState<ReadonlySet<number>>(new Set([0]));
  const root = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    // Las pantallas restantes se descargan cuando el recorrido está a menos de una pantalla de distancia (el cambio de pestaña queda inmediato).
    const el = root.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        Object.values(loaders).forEach((load) => void load());
        observer.disconnect();
      },
      { rootMargin: "900px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const select = (index: number, focus = false) => {
    const next = (index + items.length) % items.length;
    setActive(next);
    setSeen((previous) => new Set(previous).add(next));
    if (focus) tabs.current[next]?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const target = event.key === "ArrowRight" ? index + 1 : event.key === "ArrowLeft" ? index - 1 : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : null;
    if (target === null) return;
    event.preventDefault();
    select(target, true);
  };
  const current = items[active];

  return (
    <div ref={root}>
      <div role="tablist" aria-label="Pantallas de TeacherFlow" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden nav:mx-0 nav:flex-wrap nav:justify-center nav:overflow-visible nav:px-0">
        {items.map((item, index) => (
          <button
            key={item.key}
            ref={(element) => {
              tabs.current[index] = element;
            }}
            type="button"
            role="tab"
            id={`tour-tab-${item.key}`}
            aria-selected={index === active}
            aria-controls={`tour-panel-${item.key}`}
            tabIndex={index === active ? 0 : -1}
            onClick={() => select(index)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={`min-h-11 shrink-0 rounded-pill border-[1.5px] px-4 text-[14.5px] font-[650] transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-sideAccent focus-visible:ring-offset-2 focus-visible:ring-offset-side motion-reduce:transition-none ${
              index === active ? "border-white bg-white text-ink" : "border-sideLine text-sideText hover:border-sideMuted hover:bg-sideActive hover:text-white"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="mt-6 nav:mt-8">
        {items.map((item, index) => (
          <div key={item.key} role="tabpanel" id={`tour-panel-${item.key}`} aria-labelledby={`tour-tab-${item.key}`} hidden={index !== active} className="tf-tab-in">
            <div role="img" aria-label={item.alt}>
              {seen.has(index) && <TourScreen id={item.key} />}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-start justify-between gap-x-8 gap-y-4 nav:mt-8">
        <div className="max-w-[640px]" aria-live="polite">
          <p className="font-display text-[24px] font-semibold leading-tight tracking-tight text-white">{current.title}</p>
          <p className="mt-1.5 text-[16px] leading-relaxed text-sideText">{current.text}</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => select(active - 1, false)}
            aria-label="Pantalla anterior"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full border-[1.5px] border-sideLine text-white transition-colors duration-200 hover:bg-sideActive focus:outline-none focus-visible:ring-2 focus-visible:ring-sideAccent focus-visible:ring-offset-2 focus-visible:ring-offset-side motion-reduce:transition-none"
          >
            <ChevronLeftIcon className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => select(active + 1, false)}
            aria-label="Pantalla siguiente"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full border-[1.5px] border-sideLine text-white transition-colors duration-200 hover:bg-sideActive focus:outline-none focus-visible:ring-2 focus-visible:ring-sideAccent focus-visible:ring-offset-2 focus-visible:ring-offset-side motion-reduce:transition-none"
          >
            <ChevronRightIcon className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
