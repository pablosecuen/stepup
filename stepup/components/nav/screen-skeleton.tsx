import type { ReactNode } from "react";
import { ArrowLeftIcon, PencilSquareIcon, PlusIcon } from "@heroicons/react/24/outline";
import { CalendarSkeleton } from "@/components/nav/calendar-skeleton";
import { linkClass } from "@/components/ui/button";
import { PAGE_TITLE_CLASS, READING_WIDTH } from "@/components/ui/page-header";
import { CARD_CLASS, PANEL_CLASS } from "@/components/ui/surfaces";
import { ScreenFrame, SkAction, SkBar, SkHeader, SkPill, SkRound } from "@/components/ui/skeleton-kit";
import { resolveScreen } from "@/lib/nav/screens";

/**
 * Esqueletos de carga de CADA pantalla del área privada (29/10/2026). Uno por pantalla —no uno genérico para todas—, con el contenedor, los
 * márgenes, las columnas y las alturas aproximadas del contenido final y sus mismas superficies (`surfaces.ts`). Lo que no depende de
 * datos (título, nombre de la acción principal, «Volver a…») se dibuja REAL; lo demás, en barras. Se usan desde los `loading.tsx`
 * (`<RouteSkeleton path=… />`) y, idénticos, desde el esqueleto optimista del clic (`ScreenSlot`).
 */

function SkBack({ label }: { label: string }) {
  // «?»: hay enlace «Volver» pero su texto depende de desde dónde se llegó: se reserva su alto sin mostrar un texto que podría ser otro.
  return (
    <span aria-hidden className={`${linkClass()} w-fit${label === "?" ? " invisible" : ""}`}>
      <ArrowLeftIcon className="h-4 w-4 shrink-0" />
      {label}
    </span>
  );
}

/** Fila de «pastillas» de sección o de período (alto táctil de 44 px). */
function SkPills({ widths, className = "" }: { widths: string[]; className?: string }) {
  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {widths.map((width, index) => (
        <SkPill key={index} className={`h-11 ${width}`} />
      ))}
    </div>
  );
}

/** Tarjeta con título y líneas de texto. */
function SkCard({ height, className = "" }: { height: number; className?: string }) {
  return (
    <div style={{ minHeight: height }} className={`${CARD_CLASS} ${className}`}>
      <SkBar className="h-6 w-48 max-w-full" />
      <SkBar className="mt-3 h-4 w-full max-w-md opacity-80" />
      <SkBar className="mt-2 h-4 w-2/3 max-w-sm opacity-80" />
    </div>
  );
}

/** Fila de lista con avatar, dos líneas y una etiqueta a la derecha en escritorio. */
function SkRow({ height = 72 }: { height?: number }) {
  return (
    <div style={{ height }} className="flex items-center gap-3 border-b border-border px-4 last:border-b-0 nav:px-5">
      <SkRound className="h-10 w-10" />
      <div className="min-w-0 flex-1">
        <SkBar className="h-4 w-48 max-w-full" />
        <SkBar className="mt-2 h-3 w-32 max-w-full opacity-80" />
      </div>
      <SkPill className="hidden h-6 w-20 nav:block" />
    </div>
  );
}

function SkRows({ count, height }: { count: number; height?: number }) {
  return (
    <div className={`${PANEL_CLASS} overflow-hidden`}>
      {Array.from({ length: count }, (_, index) => (
        <SkRow key={index} height={height} />
      ))}
    </div>
  );
}

/** Cifra editorial (número en serifa + etiqueta): las medidas de `Figure`/`TextFigure` de Inicio. */
function SkFigure({ className = "" }: { className?: string }) {
  return (
    <div className={`min-h-11 min-w-0 px-4 py-1 first:pl-0 nav:px-7 nav:first:pl-0 ${className}`}>
      <SkBar className="h-[34px] w-12" />
      <SkBar className="mt-1 h-[13px] w-24 max-w-full opacity-80" />
    </div>
  );
}

function PanelTop() {
  return (
    <div className="flex items-center justify-between gap-3 px-4 pb-2.5 pt-3.5 nav:px-5">
      <SkBar className="h-6 w-40" />
      <SkBar className="h-5 w-16" />
    </div>
  );
}

// ───────────────────────────── Inicio ─────────────────────────────
function InicioBody() {
  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <SkBar className="h-5 w-44" />
          <SkBar className="mt-1.5 h-[38px] w-[min(420px,100%)] nav:h-[47px]" />
        </div>
        <div className="flex w-full items-center gap-3 nav:w-auto">
          <SkAction label="Nueva clase" variant="accent" icon={<PlusIcon className="h-5 w-5" />} className="flex-1 nav:flex-none" />
          <SkRound className="h-11 w-11" />
        </div>
      </header>
      <div className="mt-5 flex items-stretch divide-x divide-border border-y border-border py-3">
        {[0, 1, 2].map((index) => (
          <SkFigure key={index} />
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 border-b border-border pb-3 nav:flex nav:items-stretch nav:gap-0 nav:divide-x nav:divide-border">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="min-h-11 min-w-0 py-1 nav:px-7 nav:first:pl-0">
            <SkBar className="h-[26px] w-10" />
            <SkBar className="mt-1 h-[13px] w-28 max-w-full opacity-80" />
          </div>
        ))}
      </div>
      <div className="mt-5 grid grid-cols-1 items-start gap-5 nav:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <div className={`${PANEL_CLASS} h-[440px]`}>
            <PanelTop />
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          <div className={`${PANEL_CLASS} h-[262px]`}>
            <PanelTop />
          </div>
          <div className={`${PANEL_CLASS} h-[206px]`}>
            <PanelTop />
          </div>
          <div className={`${PANEL_CLASS} h-[138px]`}>
            <PanelTop />
          </div>
        </div>
      </div>
    </>
  );
}

// ───────────────────────────── Alumnos ─────────────────────────────
function AlumnosBody({ title }: { title: string }) {
  return (
    <>
      <SkHeader title={title} action={<SkAction label="Nuevo alumno" icon={<PlusIcon className="h-5 w-5" />} />} />
      <div className="mt-6 flex flex-col gap-3.5">
        <div className="flex flex-col gap-3">
          <div className="rounded-lg border-[1.5px] border-border bg-surface p-3 shadow-card nav:p-5">
            <div className="flex items-end gap-2 nav:flex-wrap nav:gap-3">
              <SkBar className="h-11 min-w-0 flex-1 nav:min-w-[220px] nav:flex-[2_1_240px]" />
              <div className="hidden min-w-0 flex-[4_1_640px] gap-3 nav:grid nav:grid-cols-5">
                {[0, 1, 2, 3, 4].map((index) => (
                  <div key={index}>
                    <SkBar className="h-5 w-16" />
                    <SkBar className="mt-1.5 h-11" />
                  </div>
                ))}
              </div>
              <SkBar className="hidden h-11 w-40 nav:block" />
              <SkBar className="hidden h-11 w-20 nav:block" />
              <SkBar className="h-11 w-[116px] shrink-0 nav:hidden" />
            </div>
          </div>
        </div>
        <SkBar className="h-[46px] rounded-xl" />
      </div>
      <ul className="mt-5 flex flex-col gap-3 nav:hidden">
        {[0, 1, 2, 3].map((index) => (
          <li key={index} className="flex min-h-[150px] items-start gap-3 rounded-lg border-[1.5px] border-border bg-surface px-3.5 py-3 shadow-card">
            <SkRound className="h-11 w-11" />
            <div className="min-w-0 flex-1">
              <SkBar className="h-[22px] w-44 max-w-full" />
              <SkBar className="mt-1 h-4 w-32 max-w-full opacity-80" />
              <SkBar className="mt-2 h-4 w-40 max-w-full opacity-80" />
              <SkPill className="mt-3 h-[26px] w-28" />
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-5 hidden overflow-hidden rounded-lg border-[1.5px] border-border bg-surface shadow-card nav:block">
        <div className="h-[41px] border-b-[1.5px] border-border bg-surface2" />
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <SkRow key={index} height={78} />
        ))}
      </div>
    </>
  );
}

// ───────────────────────────── Ficha del alumno ─────────────────────────────
/** Cuerpo de una pestaña del perfil: lo usa la ficha mientras llega SU contenido (el encabezado y las pestañas ya están). */
export function ProfileTabSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-5">
      <div className={`${PANEL_CLASS} h-[150px] p-4 nav:p-5`}>
        <SkBar className="h-6 w-40" />
        <SkBar className="mt-4 h-4 w-3/4 max-w-lg opacity-80" />
        <SkBar className="mt-2 h-4 w-1/2 max-w-md opacity-80" />
      </div>
      <div className={`${PANEL_CLASS} h-[220px] p-4 nav:p-5`}>
        <SkBar className="h-6 w-48" />
        <SkBar className="mt-4 h-4 w-2/3 max-w-lg opacity-80" />
        <SkBar className="mt-2 h-4 w-1/2 max-w-md opacity-80" />
      </div>
    </div>
  );
}

function AlumnoBody() {
  return (
    <>
      <SkBack label="Volver a Alumnos" />
      <div className="mt-2 flex flex-col gap-4 nav:flex-row nav:items-start nav:justify-between">
        <div className="flex min-w-0 items-start gap-4 nav:flex-1 nav:gap-5">
          <SkRound className="h-14 w-14 nav:h-24 nav:w-24" />
          <div className="min-w-0 flex-1">
            <SkBar className="h-4 w-14" />
            <SkBar className="mt-1 h-[33px] w-64 max-w-full nav:h-[43px]" />
            <div className="mt-2.5 flex flex-wrap gap-2">
              <SkPill className="h-[26px] w-16" />
              <SkPill className="h-[26px] w-20" />
              <SkPill className="h-[26px] w-24" />
            </div>
            <SkBar className="mt-2 h-[18px] w-44 opacity-80" />
          </div>
        </div>
        <SkAction label="Editar alumno" variant="secondary" icon={<PencilSquareIcon className="h-5 w-5" />} className="self-start" />
      </div>
      <div className="mt-6 -mx-4 overflow-hidden px-4 nav:mx-0 nav:px-0">
        <div className="flex w-max min-w-full gap-1 border-b-[1.5px] border-border">
          {["w-16", "w-12", "w-16", "w-12", "w-14", "w-16", "w-20"].map((width, index) => (
            <div key={index} className="flex min-h-11 items-center px-3.5 nav:px-4">
              <SkBar className={`h-4 ${width}`} />
            </div>
          ))}
        </div>
      </div>
      <div className="mt-5">
        <ProfileTabSkeleton />
      </div>
    </>
  );
}

// ───────────────────────────── Formularios (alumno, clase, registro libre) ─────────────────────────────
function FormBody({ title, back, withSubtitle }: { title: string | null; back: string | null; withSubtitle: boolean }) {
  return (
    <>
      {back && <SkBack label={back} />}
      <div className="mt-2">{title ? <SkHeader title={title} subtitle={withSubtitle} /> : <SkHeaderBar />}</div>
      <div className="mt-6 flex flex-col gap-5">
        {[4, 3].map((fields, section) => (
          <div key={section} className={`${CARD_CLASS} flex flex-col gap-5`}>
            <SkBar className="h-6 w-40" />
            {Array.from({ length: fields }, (_, index) => (
              <div key={index}>
                <SkBar className="h-5 w-28" />
                <SkBar className="mt-1.5 h-11 w-full" />
              </div>
            ))}
          </div>
        ))}
        <SkBar className="h-12 w-full nav:w-44" />
      </div>
    </>
  );
}

// ───────────────────────────── Cobros / Resumen financiero ─────────────────────────────
function CobrosBody({ title }: { title: string }) {
  return (
    <>
      <SkHeader title={title} />
      <SkPills className="mt-4" widths={["w-28", "w-24", "w-32"]} />
      <div className="mt-6 flex flex-col gap-3 nav:gap-0 nav:overflow-hidden nav:rounded-lg nav:border-[1.5px] nav:border-border nav:bg-surface nav:shadow-card">
        <div className="hidden h-[41px] border-b-[1.5px] border-border bg-surface2 nav:block" />
        {[0, 1, 2, 3, 4].map((index) => (
          <div key={index} className="flex min-h-[132px] items-start gap-3 rounded-lg border-[1.5px] border-border bg-surface p-4 shadow-card nav:h-[76px] nav:min-h-0 nav:items-center nav:rounded-none nav:border-0 nav:border-b nav:shadow-none nav:last:border-b-0">
            <SkRound className="h-10 w-10" />
            <div className="min-w-0 flex-1">
              <SkBar className="h-4 w-44 max-w-full" />
              <SkBar className="mt-2 h-3 w-32 max-w-full opacity-80" />
            </div>
            <SkPill className="hidden h-7 w-24 nav:block" />
          </div>
        ))}
      </div>
    </>
  );
}

function KpiCard({ height }: { height: number }) {
  return (
    <div style={{ minHeight: height }} className={CARD_CLASS}>
      <SkBar className="h-4 w-32 max-w-full opacity-80" />
      <SkBar className="mt-2 h-[30px] w-28" />
    </div>
  );
}

function ResumenBody({ title }: { title: string }) {
  return (
    <>
      <SkHeader title={title} subtitle />
      <SkPills className="mt-4" widths={["w-28", "w-24", "w-32"]} />
      <SkBar className="mt-3 h-6 w-52" />
      <SkPills className="mt-5" widths={["w-28", "w-28", "w-24", "w-32"]} />
      <div className="mt-5 grid grid-cols-2 gap-3 max-[400px]:grid-cols-1 nav:grid-cols-4 nav:gap-4">
        {[0, 1, 2, 3].map((index) => (
          <KpiCard key={index} height={108} />
        ))}
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 min-[480px]:grid-cols-3 nav:mt-4 nav:gap-4">
        {[0, 1, 2].map((index) => (
          <KpiCard key={index} height={92} />
        ))}
      </div>
      <div className="mt-5 grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
        <div className={`${CARD_CLASS} h-[330px]`}>
          <SkBar className="h-6 w-44" />
          <SkBar className="mt-3 h-[220px] w-full opacity-60" />
        </div>
        <div className={`${CARD_CLASS} h-[330px]`}>
          <SkBar className="h-6 w-44" />
          <SkBar className="mt-3 h-[220px] w-full opacity-60" />
        </div>
      </div>
      <div className={`${CARD_CLASS} mt-5 h-[430px]`}>
        <SkBar className="h-6 w-52" />
        <SkBar className="mt-3 h-[300px] w-full opacity-60" />
      </div>
      <div className={`${CARD_CLASS} mt-5 h-[170px]`}>
        <SkBar className="h-6 w-48" />
        <div className="mt-4 grid grid-cols-2 gap-3 nav:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <SkBar key={index} className="h-14" />
          ))}
        </div>
      </div>
      <div className="mt-5 flex flex-col gap-5 min-[1100px]:grid min-[1100px]:grid-cols-2 min-[1100px]:items-start">
        <div className="flex min-w-0 flex-col gap-5">
          <div className={`${CARD_CLASS} h-[300px]`}>
            <SkBar className="h-6 w-52" />
          </div>
          <div className={`${CARD_CLASS} h-[220px]`}>
            <SkBar className="h-6 w-40" />
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          <div className={`${CARD_CLASS} h-[260px]`}>
            <SkBar className="h-6 w-56" />
          </div>
          <div className={`${CARD_CLASS} h-[220px]`}>
            <SkBar className="h-6 w-40" />
          </div>
        </div>
      </div>
    </>
  );
}

function ComportamientoBody({ title }: { title: string }) {
  return (
    <>
      <SkBack label="Volver al Resumen financiero" />
      <div className="mt-2">
        <SkHeader title={title} />
      </div>
      <div className="mt-6 flex flex-col gap-5">
        <SkCard height={160} />
        <SkRows count={5} />
      </div>
    </>
  );
}

// ───────────────────────────── Registro / Recordatorios / Series ─────────────────────────────
function RegistroBody({ title }: { title: string }) {
  return (
    <>
      <SkHeader title={title} action={<SkAction label="Clase no programada" variant="secondary" icon={<PlusIcon className="h-5 w-5" />} />} />
      <ul className={`mt-6 flex flex-col gap-3 ${READING_WIDTH}`}>
        {[0, 1, 2, 3].map((index) => (
          <li key={index} className={`${PANEL_CLASS} flex min-h-[112px] items-start gap-3.5 p-4`}>
            <SkRound className="h-12 w-12" />
            <div className="min-w-0 flex-1">
              <SkBar className="h-[25px] w-56 max-w-full" />
              <SkBar className="mt-1.5 h-4 w-40 max-w-full opacity-80" />
              <SkBar className="mt-2 h-4 w-32 max-w-full opacity-80" />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function RecordatoriosBody({ title }: { title: string }) {
  return (
    <>
      <SkBack label="Volver a Inicio" />
      <div className="mt-3">
        <SkHeader title={title} />
      </div>
      <div className="mt-6 grid grid-cols-1 items-start gap-x-6 gap-y-6 min-[1040px]:grid-cols-2">
        {[3, 2, 2, 1].map((rows, index) => (
          <section key={index} className={`min-w-0 ${READING_WIDTH}`}>
            <div className="flex items-center gap-3">
              <SkRound className="h-9 w-9" />
              <SkBar className="h-7 w-44" />
            </div>
            <div className="mt-2.5 overflow-hidden rounded-lg border-[1.5px] border-border bg-surface shadow-card">
              {Array.from({ length: rows }, (_, row) => (
                <div key={row} className="h-[62px] border-b border-border px-4 py-2.5 last:border-b-0">
                  <SkBar className="h-[18px] w-48 max-w-full" />
                  <SkBar className="mt-1.5 h-3.5 w-32 max-w-full opacity-80" />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

function SeriesBody({ title }: { title: string }) {
  return (
    <>
      <SkBack label="Volver al Calendario" />
      <div className="mt-2">
        <SkHeader title={title} />
      </div>
      <ul className="mt-6 flex flex-col gap-3.5">
        {[0, 1, 2].map((index) => (
          <li key={index}>
            <SkCard height={150} />
          </li>
        ))}
      </ul>
    </>
  );
}

function DisponibilidadBody({ title }: { title: string }) {
  return (
    <>
      <div data-tf-header="" className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={PAGE_TITLE_CLASS}>{title}</p>
          <p className="mt-1.5 max-w-[68ch] text-[15px] text-textMuted">Bloqueos semanales y excepciones (vacaciones, feriados) — se usan para avisar de conflictos al crear/reprogramar una clase.</p>
        </div>
        <SkBar className="h-11 w-11 shrink-0" />
      </div>
      <div className="mt-6 grid grid-cols-1 items-start gap-5 nav:grid-cols-2">
        <div className={`${CARD_CLASS} min-h-[420px]`}>
          <SkBar className="h-6 w-48" />
          {[0, 1, 2, 3, 4, 5, 6].map((index) => (
            <SkBar key={index} className="mt-3 h-11 w-full opacity-80" />
          ))}
        </div>
        <div className={`${CARD_CLASS} min-h-[260px]`}>
          <SkBar className="h-6 w-56" />
          <SkBar className="mt-3 h-11 w-full opacity-80" />
          <SkBar className="mt-3 h-11 w-full opacity-80" />
        </div>
      </div>
    </>
  );
}

// ───────────────────────────── Configuración y subpantallas ─────────────────────────────
function ConfiguracionBody({ title }: { title: string }) {
  return (
    <>
      <SkHeader title={title} />
      <div className="mt-6 flex min-w-0 flex-col gap-9">
        {[2, 3, 2, 3].map((rows, section) => (
          <section key={section} className="flex flex-col gap-3">
            <SkBar className="h-5 w-28" />
            <div className="overflow-hidden rounded-lg border-[1.5px] border-border bg-surface shadow-card">
              {Array.from({ length: rows }, (_, row) => (
                <div key={row} className="flex min-h-[72px] items-center gap-4 border-b border-border px-4 py-4 last:border-b-0 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <SkBar className="h-5 w-40 max-w-full" />
                    <SkBar className="mt-2 h-4 w-64 max-w-full opacity-80" />
                  </div>
                  <SkBar className="hidden h-11 w-28 sm:block" />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

/** Subpantallas de lectura o de ajustes (consistencia, respaldo, tutorial, facturación, información, registro de una clase…): título y paneles. */
function DetailBody({ title, back, withSubtitle = true }: { title: string | null; back?: string; withSubtitle?: boolean }) {
  return (
    <>
      {back && <SkBack label={back} />}
      <div className={back ? "mt-2" : ""}>
        {title ? <SkHeader title={title} subtitle={withSubtitle} /> : <SkHeaderBar />}
      </div>
      <div className="mt-6 flex flex-col gap-5">
        <SkCard height={128} />
        <SkCard height={192} />
        <SkCard height={128} />
      </div>
    </>
  );
}

/** Encabezado cuyo título trae el contenido (nombre del alumno, fecha de la clase…): una barra del alto del título. */
function SkHeaderBar() {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <SkBar className="h-[36px] w-64 max-w-full nav:h-[47px] nav:w-80" />
        <SkBar className="mt-2.5 h-[18px] w-72 max-w-full opacity-80" />
      </div>
    </div>
  );
}

function Body({ path, title }: { path: string; title: string | null }) {
  const screen = resolveScreen(path);
  switch (screen?.key) {
    case "inicio":
      return <InicioBody />;
    case "alumnos":
      return <AlumnosBody title={title ?? "Alumnos"} />;
    case "alumno":
      return <AlumnoBody />;
    case "alumno-form":
    case "clase-form":
    case "registro-form":
      return <FormBody title={title} back={screen.back} withSubtitle />;
    case "cobros":
      return <CobrosBody title={title ?? "Cobros"} />;
    case "resumen":
      return <ResumenBody title={title ?? "Resumen financiero"} />;
    case "comportamiento":
      return <ComportamientoBody title={title ?? "Comportamiento de pago"} />;
    case "registro":
      return <RegistroBody title={title ?? "Clases por registrar"} />;
    case "recordatorios":
      return <RecordatoriosBody title={title ?? "Recordatorios"} />;
    case "series":
    case "serie":
      return <SeriesBody title={title ?? "Series"} />;
    case "disponibilidad":
      return <DisponibilidadBody title={title ?? "Disponibilidad"} />;
    case "configuracion":
      return <ConfiguracionBody title={title ?? "Configuración"} />;
    case "calendario-info":
      return <DetailBody title={title} back={screen.back ?? undefined} />;
    case "registro-detalle":
    case "config-sub":
    case "facturacion-sub":
      return <DetailBody title={title} back={screen.back ?? undefined} />;
    case "facturacion":
      return <DetailBody title={title} />;
    default:
      return <DetailBody title={title} />;
  }
}

/**
 * El esqueleto de la pantalla de `path` (una ruta de muestra para las dinámicas: «/alumnos/_», «/registro/_»…). `optimistic` es el que se
 * dibuja al hacer clic, antes de que el servidor responda; `retryHref` es a dónde lleva «Reintentar» si la carga se cuelga.
 */
export function RouteSkeleton({ path, optimistic = false, retryHref }: { path: string; optimistic?: boolean; retryHref?: string }): ReactNode {
  const screen = resolveScreen(path);
  if (!screen) return null;
  if (screen.key === "calendario") return <CalendarSkeleton label={screen.label} optimistic={optimistic} retryHref={retryHref} />;
  return (
    <ScreenFrame label={screen.label} width={screen.width} optimistic={optimistic} retryHref={retryHref}>
      <Body path={path} title={screen.title} />
    </ScreenFrame>
  );
}
