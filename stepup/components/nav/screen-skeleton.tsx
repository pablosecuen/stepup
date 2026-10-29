import type { CSSProperties, ReactNode } from "react";
import { ArrowLeftIcon, CheckIcon, PencilSquareIcon, PlusIcon } from "@heroicons/react/24/outline";
import { CalendarSkeleton } from "@/components/nav/calendar-skeleton";
import { linkClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { AVAILABILITY_EMPTY_CLASS, AVAILABILITY_FORM_GRID, AVAILABILITY_ROW_CLASS } from "@/components/calendar/availability-layout";
import { PAGE_TITLE_CLASS, READING_WIDTH } from "@/components/ui/page-header";
import { CARD_CLASS, PANEL_CLASS } from "@/components/ui/surfaces";
import { ScreenFrame, SkAction, SkBar, SkHeader, SkPill, SkRound } from "@/components/ui/skeleton-kit";
import { SettingsCard, SettingsRow, SettingsSection } from "@/components/account/settings-ui";
import { CARD_TITLE_CLASS, FINANCIAL_PRESETS, Kpi, Stat, periodPillClass } from "@/components/finance/overview-parts";
import { PaymentsSectionNav } from "@/components/payments/payments-section-nav";
import { COLLECTIONS_HEADER_CLASS, COLLECTIONS_ROW_CLASS, COLLECTIONS_TABLE_CLASS } from "@/components/payments/collections-layout";
import { FINANCIAL_PERIOD_PRESET_LABEL } from "@/lib/reports/period";
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

/** Cifra editorial (número en serifa + etiqueta): las medidas de `Figure` de Inicio (el número baja a 28 px bajo 420 px de ancho, como el real). */
function SkFigure({ className = "" }: { className?: string }) {
  return (
    <div className={`min-h-11 min-w-0 px-4 py-1 first:pl-0 nav:px-7 nav:first:pl-0 ${className}`}>
      <SkBar className="h-[34px] w-12 max-[420px]:h-[28px]" />
      <SkBar className="mt-1 h-4 w-24 max-w-full opacity-80" />
    </div>
  );
}

/** Encabezado de un panel de Inicio: con `title` es el título REAL (mismo estilo que `PanelHeader`); sin él, una barra. */
function PanelTop({ title }: { title?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 pb-2.5 pt-3.5 nav:px-5">
      {title ? <p className="font-display text-[20px] font-semibold leading-tight tracking-tight">{title}</p> : <SkBar className="h-6 w-40" />}
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
          <SkBar className="mt-1 h-[38px] w-[min(420px,100%)] nav:h-[47px]" />
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
      {/* Aviso de cobros del día: 150 px en escritorio y 142 px en móvil (medidos en Production con datos de QA) */}
      <div className="mt-[15px] h-[142px] rounded-xl border-[1.5px] border-border bg-surface2 nav:h-[150px]" />
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 border-b border-border pb-3 nav:flex nav:items-stretch nav:gap-0 nav:divide-x nav:divide-border">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="min-h-11 min-w-0 py-1 nav:px-7 nav:first:pl-0">
            <SkBar className="h-[26px] w-10 max-[420px]:h-[22px]" />
            <SkBar className="mt-1 h-4 w-28 max-w-full opacity-80" />
          </div>
        ))}
      </div>
      <div className="mt-5 grid grid-cols-1 items-start gap-5 nav:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <div className={`${PANEL_CLASS} h-[166px] nav:h-[117px]`}>
            <PanelTop />
          </div>
          <div className={`${PANEL_CLASS} h-[279px] nav:h-[219px]`}>
            <PanelTop title="Tu día" />
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          <div className={`${PANEL_CLASS} h-[351px] nav:h-[321px]`}>
            <PanelTop title="Clases por registrar" />
          </div>
          <div className={`${PANEL_CLASS} h-[238px]`}>
            <PanelTop title="Recordatorios" />
          </div>
          <div className={`${PANEL_CLASS} h-[146px]`}>
            <PanelTop title="Cobros de hoy" />
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
        <SkBar className="h-[58px] rounded-xl" />
      </div>
      <ul className="mt-5 flex flex-col gap-3 nav:hidden">
        {[0, 1, 2, 3, 4].map((index) => (
          <li key={index} className="flex min-h-[217px] items-start gap-3 rounded-lg border-[1.5px] border-border bg-surface px-3.5 py-3 shadow-card">
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
        <div className="h-[50px] border-b-[1.5px] border-border bg-surface2" />
        {[0, 1, 2, 3, 4].map((index) => (
          <SkRow key={index} height={110} />
        ))}
      </div>
    </>
  );
}

// ───────────────────────────── Ficha del alumno ─────────────────────────────
/** Un bloque con el aspecto de un panel real (borde, radio y sombra de `PANEL_CLASS`) y el alto medido. */
function ProfilePanel({ className }: { className: string }) {
  return (
    <div className={`${PANEL_CLASS} p-4 nav:p-5 ${className}`}>
      <SkBar className="h-6 w-40" />
      <SkBar className="mt-4 h-4 w-3/4 max-w-lg opacity-80" />
      <SkBar className="mt-2 h-4 w-1/2 max-w-md opacity-80" />
    </div>
  );
}

/**
 * Cuerpo de una pestaña del perfil: lo usa la ficha mientras llega SU contenido (el encabezado y las pestañas ya están). «Resumen» (la pestaña de
 * entrada) con su disposición real medida en Production: la columna de contenido (gap 16 px) + «cambiar estado» (gap 24 px), a 390 y a 1366 px:
 * 165/121 · 117 · 236/119 · 220/117, y 344/242 + 158/138. Las demás pestañas, dos bloques.
 */
export function ProfileTabSkeleton({ tab = "resumen" }: { tab?: string }) {
  if (tab === "resumen") {
    return (
      <div aria-hidden className="flex flex-col gap-6">
        <div className="flex flex-col gap-4">
          <ProfilePanel className="h-[165px] nav:h-[121px]" />
          <ProfilePanel className="h-[117px]" />
          <ProfilePanel className="h-[236px] nav:h-[119px]" />
          <ProfilePanel className="h-[220px] nav:h-[117px]" />
        </div>
        <div>
          <ProfilePanel className="h-[344px] nav:h-[242px]" />
          <ProfilePanel className="mt-5 h-[158px] nav:h-[138px]" />
        </div>
      </div>
    );
  }
  return (
    <div aria-hidden className="flex flex-col gap-4">
      <ProfilePanel className="h-[150px]" />
      <ProfilePanel className="h-[220px]" />
    </div>
  );
}

const PROFILE_TABS = ["Resumen", "Clases", "Progreso", "Tareas", "Cobros", "Reportes", "Información"];

function AlumnoBody() {
  // El MISMO marcado que `StudentProfileHeader` y `ProfileTabsNav` (clases y textos fijos reales); sólo el nombre, el estado y la fecha son bloques.
  return (
    <>
      <header>
        <SkBack label="Volver a Alumnos" />
        <div className="mt-2 flex flex-col gap-4 nav:flex-row nav:items-start nav:justify-between">
          <div className="flex min-w-0 items-start gap-4 nav:flex-1 nav:gap-5">
            <SkRound className="h-14 w-14 nav:h-24 nav:w-24" />
            <div className="min-w-0 flex-1">
              <p className="text-label font-bold uppercase text-textMuted">Alumno</p>
              <p className="mt-0.5 font-display text-[30px] font-medium leading-[1.08] tracking-[-0.03em] nav:text-[40px]">
                <Ph text="Nombre del alumno" />
              </p>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <SkPill className="h-[26px] w-16" />
                <SkPill className="h-[26px] w-20" />
                <SkPill className="h-[26px] w-24" />
              </div>
              <p className="mt-2 text-[14.5px] text-textMuted">
                <Ph text="Alumno desde 00/00/0000" />
              </p>
            </div>
          </div>
          <SkAction label="Editar alumno" variant="secondary" icon={<PencilSquareIcon className="h-5 w-5" />} className="self-start" />
        </div>
      </header>
      <div className="mt-6">
        <nav className="relative -mx-4 overflow-hidden px-4 nav:mx-0 nav:px-0">
          <ul className="flex w-max min-w-full gap-1 border-b-[1.5px] border-border">
            {PROFILE_TABS.map((label, index) => (
              <li key={label}>
                <span
                  className={`-mb-[1.5px] inline-flex min-h-11 items-center whitespace-nowrap border-b-[3px] px-3.5 text-[14.5px] nav:px-4 ${index === 0 ? "border-ink font-bold text-textPrimary" : "border-transparent font-semibold text-textMuted"}`}
                >
                  {label}
                </span>
              </li>
            ))}
          </ul>
        </nav>
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
      <PaymentsSectionNav current="collections" />
      <div className={COLLECTIONS_TABLE_CLASS}>
        <div aria-hidden className={COLLECTIONS_HEADER_CLASS}>
          <span>Alumno</span>
          <span>Concepto</span>
          <span>Vence</span>
          <span>Estado</span>
          <span className="text-right">Saldo pendiente</span>
          <span className="w-[272px]" />
        </div>
        <ul className="flex flex-col gap-3 nav:gap-0">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((index) => (
            // Misma clase de fila que la real (`COLLECTIONS_ROW_CLASS`): tarjeta en móvil (~256 px con su contenido), fila de tabla en escritorio.
            <li key={index} className={`${COLLECTIONS_ROW_CLASS} min-h-[256px] nav:min-h-0`}>
              <div className="flex min-w-0 items-center gap-3">
                <SkRound className="h-10 w-10" />
                <div className="-my-1 flex min-h-11 items-center">
                  <SkBar className="h-5 w-40" />
                </div>
              </div>
              <div className="flex flex-wrap items-baseline gap-x-1.5 text-[14px] nav:contents">
                <p className="min-w-0 nav:text-[14.5px]">
                  <Ph text="Mensualidad" />
                </p>
                <p className="nav:text-[14.5px]">
                  <Ph text="00/00/0000" />
                </p>
              </div>
              <div>
                <SkPill className="h-[26px] w-24" />
              </div>
              <div className="min-w-0 nav:text-right">
                <p className="text-[13px] nav:sr-only">Saldo pendiente</p>
                <p className="font-display text-[26px] font-semibold leading-none tracking-tight nav:text-[20px]">
                  <Ph text="$ 00.000,00" />
                </p>
              </div>
              <div className="flex gap-2 nav:w-[272px]">
                <SkBar className="h-11 w-32" />
                <SkBar className="h-11 w-32" />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

/** Un dato en espera: un bloque con el MISMO tamaño de letra que el dato real (la línea mide lo mismo), nunca un alto inventado. */
function Ph({ text, className = "" }: { text: string; className?: string }) {
  return <span className={`rounded bg-paperDeep text-transparent ${className}`}>{text}</span>;
}

/**
 * Tarjeta de un bloque de Resumen financiero cuyo cuerpo es un gráfico o una lista: el borde, el relleno y el título son los reales
 * (`CARD_CLASS` + `CARD_TITLE_CLASS`) y el cuerpo reserva el alto que mide ese bloque con datos reales (`mobile` por debajo de 820 px, `desktop`
 * desde 820 px). El alto del cuerpo = el total medido menos el borde, el relleno (16 px móvil · 20 px escritorio por lado), el título (24 px) y su separación (12 px).
 */
function OverviewCard({ title, mobile, desktop, className = "" }: { title: string; mobile: number; desktop: number; className?: string }) {
  const style = { "--m": `${mobile - 71}px`, "--d": `${desktop - 79}px` } as CSSProperties;
  return (
    <div className={`${CARD_CLASS} ${className}`}>
      <p className={CARD_TITLE_CLASS}>{title}</p>
      <div style={style} className="mt-3 h-[var(--m)] nav:h-[var(--d)]">
        <SkBar className="h-full w-full opacity-50" />
      </div>
    </div>
  );
}

function ResumenBody({ title }: { title: string }) {
  return (
    <>
      <SkHeader title={title} subtitle="Tus cobros, actividad y una guía para organizar lo ingresado." />
      <PaymentsSectionNav current="overview" />
      <p className="mt-3">
        <span className={linkClass()}>Ver comportamiento de pago</span>
      </p>
      <nav className="mt-5">
        <ul className="flex flex-wrap gap-2">
          {FINANCIAL_PRESETS.map((preset, index) => (
            <li key={preset}>
              <span className={periodPillClass(index === 0)}>
                {index === 0 && <CheckIcon className="h-4 w-4" />}
                {FINANCIAL_PERIOD_PRESET_LABEL[preset]}
              </span>
            </li>
          ))}
        </ul>
      </nav>

      <section className="mt-5 grid grid-cols-2 gap-3 max-[400px]:grid-cols-1 nav:grid-cols-4 nav:gap-4">
        <Kpi label="Facturación prevista" value={<Ph text="$ 000.000,00" />} foot={<Ph text="vs. período anterior: +0 %" />} />
        <Kpi label="Cobrado (por fecha real de pago)" value={<Ph text="$ 000.000,00" />} foot={<Ph text="vs. período anterior: +0 %" />} />
        <Kpi label="Pendiente en término" value={<Ph text="$ 000.000,00" />} />
        <Kpi label="Vencido" value={<Ph text="$ 000.000,00" />} />
      </section>
      <section className="mt-3 grid grid-cols-1 gap-3 min-[480px]:grid-cols-3 nav:mt-4 nav:gap-4">
        <Kpi label="Deuda de meses anteriores" value={<Ph text="$ 000.000,00" />} />
        <Kpi label="Alumnos que pagaron este mes" value={<Ph text="00" />} />
        <Kpi label="Alumnos con deuda" value={<Ph text="00" />} />
      </section>

      <div className="mt-5 grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
        <OverviewCard title="Evolución de cobros" mobile={457} desktop={465} />
        <OverviewCard title="Distribución sugerida" mobile={605} desktop={449} />
      </div>
      <OverviewCard title="Proyección y ahorro" mobile={752} desktop={555} className="mt-5" />
      <section className={`${CARD_CLASS} mt-5`}>
        <p className={CARD_TITLE_CLASS}>Actividad del período</p>
        <div className="mt-4 grid grid-cols-2 gap-3 nav:grid-cols-4">
          <Stat label="Clases dictadas" value={<Ph text="00" />} />
          <Stat label="Horas dictadas" value={<Ph text="000 h" />} />
          <Stat label="Horas reprogramadas" value={<Ph text="00 h" />} />
          <Stat label="Horas canceladas" value={<Ph text="00 h" />} />
        </div>
      </section>
      <div className="mt-5 flex flex-col gap-5 min-[1100px]:grid min-[1100px]:grid-cols-2 min-[1100px]:items-start">
        <div className="flex min-w-0 flex-col gap-5">
          <OverviewCard title="Valor programado de tu hora" mobile={543} desktop={416} />
          <OverviewCard title="Resumen anual" mobile={286} desktop={252} />
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          <OverviewCard title="Demanda semanal y horaria" mobile={359} desktop={345} />
          <OverviewCard title="Alumnos del año" mobile={428} desktop={396} />
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
        {[0, 1, 2, 3, 4].map((index) => (
          <li key={index} className={`${PANEL_CLASS} flex min-h-[140px] items-start gap-3.5 p-4 nav:min-h-[83px]`}>
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
      {/* La MISMA lista que la real: tope de 70 vh (`max-h-[70vh]`), así el alto depende de la ventana igual que en la pantalla final */}
      <ul className="mt-6 flex max-h-[70vh] flex-col gap-3.5 overflow-hidden pr-1">
        {[0, 1, 2].map((index) => (
          <li key={index}>
            <div className={`${CARD_CLASS} min-h-[320px] nav:min-h-[182px]`}>
              <SkBar className="h-6 w-48 max-w-full" />
              <SkBar className="mt-3 h-4 w-full max-w-md opacity-80" />
              <SkBar className="mt-2 h-4 w-2/3 max-w-sm opacity-80" />
            </div>
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
      {/* El editor, con las MISMAS piezas: tarjetas (`Card`), títulos y etiquetas reales, la grilla de formulario compartida (`availability-layout.ts`, se reparte en
          columnas según el ancho igual que la real) y controles del alto real (46 px). Las listas dependen de los datos: se reservan dos filas de bloqueos. */}
      <div className="mt-6 flex flex-col gap-5">
        <Card>
          <h2 className="font-display text-card font-semibold">Bloqueos semanales</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {[0].map((row) => (
              <li key={row} className={AVAILABILITY_ROW_CLASS}>
                <span className="min-w-0 py-1.5">
                  <Ph text="Lunes 00:00–00:00 · Trabajo" />
                </span>
                <SkBar className="h-11 w-20" />
              </li>
            ))}
          </ul>
          <div className={AVAILABILITY_FORM_GRID}>
            {["Día", "Desde", "Hasta", "Motivo"].map((label) => (
              <Field key={label} label={label} htmlFor={`sk-${label}`}>
                <SkBar className={label === "Desde" || label === "Hasta" ? "h-11" : "h-[46px]"} />
              </Field>
            ))}
            <SkAction label="Agregar bloqueo" variant="secondary" className="w-full" />
          </div>
        </Card>
        <Card>
          <h2 className="font-display text-card font-semibold">Excepciones (vacaciones, feriados)</h2>
          <ul className="mt-3 flex flex-col gap-2">
            <li className={AVAILABILITY_EMPTY_CLASS}>Sin excepciones todavía.</li>
          </ul>
          <div className={AVAILABILITY_FORM_GRID}>
            {["Desde", "Hasta (opcional)", "Motivo"].map((label) => (
              <Field key={label} label={label} htmlFor={`sk-ex-${label}`}>
                <SkBar className={label === "Motivo" ? "h-[46px]" : "h-11"} />
              </Field>
            ))}
            <SkAction label="Agregar excepción" variant="secondary" className="w-full" />
          </div>
        </Card>
      </div>
    </>
  );
}

// ───────────────────────────── Configuración y subpantallas ─────────────────────────────
function ConfiguracionBody({ title }: { title: string }) {
  // Las MISMAS piezas que la pantalla real (`SettingsSection`/`SettingsCard`/`SettingsRow`) con sus textos fijos; sólo los datos y los controles son bloques
  // (del alto real del control: 44 px los botones y el campo, 96 px las dos opciones de la ubicación de la navegación). Un test comprueba que cada texto
  // existe también en `configuration-view.tsx` / `navigation-preference.tsx`. «Datos de prueba» sólo existe si hay datos de prueba marcados: no se reserva.
  return (
    <>
      <SkHeader title={title} subtitle="Tu cuenta, preferencias y datos." />
      <div className="mt-6 flex min-w-0 flex-col gap-9">
        <SettingsSection id="sk-cuenta" title="Cuenta" description="Tus datos de acceso y cómo aparecés en TeacherFlow." columns="lg:grid-cols-2">
          <SettingsCard>
            <div className="flex items-center gap-4 px-4 py-4 sm:px-5">
              <SkRound className="h-12 w-12" />
              <div className="min-w-0">
                <SkBar className="h-7 w-40" />
                <SkBar className="mt-0.5 h-5 w-48 max-w-full" />
              </div>
            </div>
            <SettingsRow title="Nombre visible" description="Es el nombre que usa el saludo de Inicio.">
              <SkBar className="h-11 w-full" />
            </SettingsRow>
          </SettingsCard>
          <SettingsCard>
            <SettingsRow title="Contraseña" description="Te enviamos un enlace a tu correo para elegir una nueva.">
              <SkBar className="h-11 w-44" />
            </SettingsRow>
          </SettingsCard>
        </SettingsSection>

        <SettingsSection id="sk-preferencias" title="Preferencias" description="Organizá cómo funciona TeacherFlow." columns="max-w-[480px]">
          <SettingsCard>
            <SettingsRow title="Ubicación de la navegación" description="Elegí la barra inferior o los accesos dentro del logo. Se guarda en este navegador, como preferencia del dispositivo.">
              <SkBar className="h-24 w-full" />
            </SettingsRow>
          </SettingsCard>
          <SettingsCard>
            <SettingsRow title="Dos dispositivos a la vez" description="Podés mantener dos sesiones abiertas. Al entrar desde un tercer dispositivo se elige cuál reemplazar. Cada sesión es independiente." />
          </SettingsCard>
          <SettingsCard>
            <SettingsRow title="Tutorial de TeacherFlow" description="Volvé a recorrer las funciones principales.">
              <SkBar className="h-11 w-32" />
            </SettingsRow>
          </SettingsCard>
          <SettingsCard>
            <SettingsRow title="Políticas de cobro" description="Los recargos por atraso están desactivados. El semáforo de mora usa plazos fijos." />
          </SettingsCard>
          <SettingsCard>
            <SettingsRow title="Revisar consistencia" description="Detecta diferencias y permite revisar las correcciones seguras. Los casos ambiguos conservan sus pagos y quedan para revisión.">
              <SkBar className="h-11 w-36" />
            </SettingsRow>
          </SettingsCard>
        </SettingsSection>

        <SettingsSection id="sk-acciones-sensibles" title="Acciones sensibles" description="Afectan a tu cuenta. Siempre piden confirmación antes de ejecutarse." columns="max-w-[560px]">
          <SettingsCard>
            <SettingsRow title="Eliminar cuenta" description="Borra tu cuenta y todos tus datos de forma permanente.">
              <SkBar className="h-11 w-40" />
            </SettingsRow>
          </SettingsCard>
        </SettingsSection>
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
