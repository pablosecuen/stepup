import type { ReactNode } from "react";
import { BanknotesIcon, CalendarDaysIcon, ClipboardDocumentCheckIcon, Cog6ToothIcon, HomeIcon, UsersIcon } from "@heroicons/react/24/outline";

/**
 * Marcos de las maquetas de la landing. TODO lo que se dibuja adentro es DEMOSTRATIVO (datos sintéticos): cada composición se
 * publica como `role="img"` con una descripción en texto (`MockScene`), así lectores de pantalla y teclado no se topan con
 * controles que no existen. Sólo HTML y CSS: ninguna imagen salvo el ícono de la marca.
 */

/** Composición demostrativa: una sola imagen accesible con su descripción; lo de adentro es presentacional. */
export function MockScene({ label, className = "", children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div role="img" aria-label={label} className={className}>
      {children}
    </div>
  );
}

const NAV = [
  { key: "inicio", label: "Inicio", Icon: HomeIcon },
  { key: "alumnos", label: "Alumnos", Icon: UsersIcon },
  { key: "calendario", label: "Calendario", Icon: CalendarDaysIcon },
  { key: "cobros", label: "Cobros", Icon: BanknotesIcon },
  { key: "registro", label: "Registro", Icon: ClipboardDocumentCheckIcon },
] as const;

export type MockNavKey = (typeof NAV)[number]["key"];

/** Interior de la plataforma: barra lateral oscura (desde 640 px de ventana), barra inferior más angosta, y el contenido. Se recompone por ancho de ventana. */
export function MockApp({ active, children }: { active: MockNavKey; children: ReactNode }) {
  return (
    <div className="tf-mk select-none">
      <div className="tf-mk-frame bg-background text-textPrimary">
        <aside className="tf-mk-side min-h-full flex-col gap-1 bg-side px-1.5 py-3 text-sideText">
          <div className="mb-2 flex items-center gap-2 px-1.5">
            <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[6px] bg-background font-display text-[13px] font-semibold leading-none text-ink">T</span>
            <span className="tf-mk-lbl font-display text-[14px] font-semibold text-white">TeacherFlow</span>
          </div>
          {NAV.map(({ key, label, Icon }) => (
            <div key={key} className={`flex items-center gap-2 rounded-md px-2.5 py-2 text-[12.5px] font-medium ${key === active ? "bg-sideActive text-white" : ""}`}>
              <Icon className="h-[17px] w-[17px] shrink-0" />
              <span className="tf-mk-lbl">{label}</span>
            </div>
          ))}
          <div className="mt-auto flex items-center gap-2 px-2.5 py-2 text-[12.5px] text-sideMuted">
            <Cog6ToothIcon className="h-[17px] w-[17px] shrink-0" />
            <span className="tf-mk-lbl">Configuración</span>
          </div>
        </aside>
        <div className="flex min-w-0 flex-col">
          <div className="min-w-0 flex-1 px-3.5 pb-4 pt-3.5">{children}</div>
          <div className="tf-mk-tabbar justify-around border-t border-border bg-surface px-1 py-1.5 text-textMuted">
            {NAV.map(({ key, label, Icon }) => (
              <div key={key} className={`flex flex-col items-center gap-0.5 text-[11px] font-medium ${key === active ? "text-accentDark" : ""}`}>
                <Icon className="h-[18px] w-[18px]" />
                {label}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Computadora de escritorio: pantalla con borde, barra de navegador y pie. En pantallas chicas queda sólo la ventana. */
export function Monitor({ path, children, className = "" }: { path: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="rounded-[12px] bg-[#16120d] p-[5px] shadow-panel min-[820px]:rounded-[20px] min-[820px]:p-[9px]">
        <div className="overflow-hidden rounded-[8px] bg-background min-[820px]:rounded-[12px]">
          <div className="flex h-8 items-center gap-2 border-b border-border bg-paperDeep px-3">
            <span className="flex gap-1.5">
              <i className="block h-2.5 w-2.5 rounded-full bg-borderMid" />
              <i className="block h-2.5 w-2.5 rounded-full bg-borderMid" />
              <i className="block h-2.5 w-2.5 rounded-full bg-borderMid" />
            </span>
            <span className="mx-auto flex h-5 w-full max-w-[300px] items-center justify-center truncate rounded-pill bg-surface px-3 text-[11px] text-textMuted">teacherflowapp.com/{path}</span>
            <span className="w-10" />
          </div>
          {children}
        </div>
      </div>
      <div className="mx-auto hidden h-5 w-24 bg-gradient-to-b from-[#3a3126] to-[#241d15] min-[820px]:block" />
      <div className="mx-auto hidden h-1.5 w-44 rounded-full bg-[#241d15] min-[820px]:block" />
    </div>
  );
}

/** Ventana sola (sin pie de computadora), para escenas con varias pantallas. */
export function MiniWindow({ path, children, className = "" }: { path: string; children: ReactNode; className?: string }) {
  return (
    <div className={`overflow-hidden rounded-[12px] border-[1.5px] border-borderMid bg-background shadow-panel ${className}`}>
      <div className="flex h-7 items-center gap-2 border-b border-border bg-paperDeep px-3">
        <span className="flex gap-1.5">
          <i className="block h-2 w-2 rounded-full bg-borderMid" />
          <i className="block h-2 w-2 rounded-full bg-borderMid" />
          <i className="block h-2 w-2 rounded-full bg-borderMid" />
        </span>
        <span className="truncate text-[11px] text-textMuted">teacherflowapp.com/{path}</span>
      </div>
      {children}
    </div>
  );
}

/** Panel flotante con una acción concreta (ventana emergente de la maqueta). */
export function FloatCard({ eyebrow, icon, tone = "light", className = "", children }: { eyebrow: string; icon?: ReactNode; tone?: "light" | "dark"; className?: string; children: ReactNode }) {
  const dark = tone === "dark";
  return (
    <div className={`rounded-[14px] border-[1.5px] p-3.5 shadow-panel ${dark ? "border-sideLine bg-side text-white" : "border-border bg-surface text-textPrimary"} ${className}`}>
      <p className={`flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-[0.09em] ${dark ? "text-sideText" : "text-textMuted"}`}>
        {icon}
        {eyebrow}
      </p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

/** Encabezado de una pantalla de la maqueta. */
export function MockHeader({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        {sub && <p className="text-[12px] font-[650] text-textMuted">{sub}</p>}
        <p className="font-display text-[24px] font-medium leading-tight tracking-[-0.02em]">{title}</p>
      </div>
      {right}
    </div>
  );
}
