"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import { Monitor } from "@/components/landing/frame";

export interface TourItem {
  key: string;
  label: string;
  title: string;
  text: string;
  /** Descripción en texto de la pantalla demostrativa (la maqueta es una sola imagen para lectores de pantalla). */
  alt: string;
}

const ARROW =
  "inline-flex h-11 w-11 items-center justify-center rounded-full border-[1.5px] border-sideLine text-white transition-colors duration-200 hover:bg-sideActive focus:outline-none focus-visible:ring-2 focus-visible:ring-sideAccent focus-visible:ring-offset-2 focus-visible:ring-offset-side motion-reduce:transition-none";

/**
 * Recorrido interactivo: la computadora permanece y la persona elige la pantalla (pestañas accesibles con flechas, Inicio y Fin, y
 * botones Anterior / Siguiente). Las cinco maquetas llegan renderizadas desde el servidor, sin descargar componentes al elegirlas.
 *
 * Comparten UN solo marco: el recorrido completo (pestañas, pantalla, descripción y flechas) mide como máximo lo que queda visible bajo el
 * encabezado fijo y nunca más de lo que su ancho justifica (ver `.tf-tour` en landing-natural.css). El alto lo reparte una columna flexible:
 * pestañas y pie con su alto propio y la pantalla con todo lo que sobra, así pestañas, marco y flechas no se mueven al cambiar de pantalla.
 * Lo que no entra en la pantalla se recorre dentro de su área. Sólo se muestra la elegida, con un cambio suave de 260 ms (sin movimiento con
 * «reducir movimiento»). No es un video: nada avanza solo.
 */
export function Tour({ items, screens }: { items: readonly TourItem[]; screens: readonly ReactNode[] }) {
  const [active, setActive] = useState(0);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const select = (index: number, focus = false) => {
    const next = (index + items.length) % items.length;
    setActive(next);
    if (focus) tabs.current[next]?.focus({ preventScroll: true });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const target = event.key === "ArrowRight" ? index + 1 : event.key === "ArrowLeft" ? index - 1 : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : null;
    if (target === null) return;
    event.preventDefault();
    select(target, true);
  };
  const current = items[active];

  return (
    <div className="tf-tour">
      <div role="tablist" aria-label="Pantallas de TeacherFlow" className="tf-tour-tabs -mx-3 flex gap-2 overflow-x-auto px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden nav:mx-0 nav:flex-wrap nav:justify-center nav:overflow-visible nav:px-0">
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
            className={`tf-tour-tab tf-ctl min-h-11 shrink-0 rounded-pill border-[1.5px] px-4 text-[14.5px] font-[650] transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-sideAccent focus-visible:ring-offset-2 focus-visible:ring-offset-side motion-reduce:transition-none ${
              index === active ? "border-white bg-white text-ink" : "border-sideLine text-sideText hover:border-sideMuted hover:bg-sideActive hover:text-white"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <Monitor className="tf-tour-monitor" path={current.key === "perfil" ? "alumnos/perfil" : current.key === "resumen" ? "resumen-financiero" : current.key}>
        <div className="tf-tour-stage">
          {items.map((item, index) => (
            <div key={item.key} role="tabpanel" id={`tour-panel-${item.key}`} aria-labelledby={`tour-tab-${item.key}`} hidden={index !== active} inert={index !== active} className={index === active ? "tf-tour-panel tf-tab-in" : "tf-tour-panel"}>
              <div role="img" aria-label={item.alt} className="tf-tour-screen">
                {screens[index]}
              </div>
            </div>
          ))}
        </div>
      </Monitor>

      <div className="tf-tour-foot" aria-live="polite">
        <div className="tf-tour-titles">
          {items.map((item, index) => (
            <p key={item.key} hidden={index !== active} className="font-display text-[20px] font-semibold leading-tight tracking-tight text-white nav:text-[22px]">
              {item.title}
            </p>
          ))}
        </div>
        <div className="tf-tour-texts">
          {items.map((item, index) => (
            <p key={item.key} hidden={index !== active} className="text-[15px] leading-snug text-sideText nav:text-[16px]">
              {item.text}
            </p>
          ))}
        </div>
        <div className="tf-tour-arrows">
          <button type="button" onClick={() => select(active - 1, false)} aria-label="Pantalla anterior" className={ARROW}>
            <ChevronLeftIcon className="h-5 w-5" />
          </button>
          <button type="button" onClick={() => select(active + 1, false)} aria-label="Pantalla siguiente" className={ARROW}>
            <ChevronRightIcon className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
