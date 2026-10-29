import type { ReactNode } from "react";
import { ArrowRightIcon, CheckCircleIcon, ChevronLeftIcon, ChevronRightIcon, MagnifyingGlassIcon, PlusIcon } from "@heroicons/react/24/outline";
import { Avatar } from "@/components/ui/avatar";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { MockApp, MockHeader, NotificationBadge } from "@/components/landing/frame";
import { CANCELLED_COLORS, CARD_TEXT_COLORS, CURRENT_TIME_COLOR, ELAPSED_COLORS, MODALITY_COLORS, MODALITY_LABELS, REPLACEMENT_COLORS, type LessonModality } from "@/lib/calendar-theme";
import { formatMoney } from "@/lib/format/number-format";
import {
  DAY_LESSONS,
  DEMO_BUDGET,
  DEMO_CHARGES,
  DEMO_COLLECTED,
  DEMO_COLLECTED_THIS_MONTH,
  DEMO_HISTORY,
  DEMO_PAYMENTS,
  DEMO_STUDENTS,
  WEEK_DAYS,
  WEEK_FIRST_HOUR,
  WEEK_HOURS,
  WEEK_LESSONS,
  type DemoChargeState,
  type DemoDayLesson,
  type DemoLesson,
} from "@/lib/landing/demo-data";

/**
 * Pantallas demostrativas de TeacherFlow (HTML y CSS, datos sintéticos de lib/landing/demo-data.ts). Reproducen la composición de
 * las pantallas reales: mismos tokens, mismos estados, escala de color del calendario congelada y etiquetas con texto además del color.
 */

const PANEL = "rounded-[12px] border-[1.5px] border-border bg-surface shadow-subtle";
const CHARGE_TONE: Record<DemoChargeState, BadgeTone> = { "Vence hoy": "warn", Vencido: "bad", "Vence pronto": "warn", Pendiente: "neutral", "Pago parcial": "info", Pagado: "ok" };

function Figure({ value, label, tone }: { value: string; label: string; tone?: string }) {
  return (
    <div className="min-w-0 px-2.5 first:pl-0 min-[820px]:px-3.5">
      <p className={`font-display text-[26px] font-medium leading-none tracking-tight tf-num ${tone ?? ""}`}>{value}</p>
      <p className="tf-fig-label mt-1 text-[11.5px] font-medium leading-tight tracking-[-0.01em] text-textMuted min-[820px]:text-[12px] min-[820px]:tracking-normal">{label}</p>
    </div>
  );
}

function Segmented({ items, active }: { items: readonly string[]; active: string }) {
  return (
    <div className="inline-flex gap-0.5 rounded-md bg-paperDeep p-0.5 ring-1 ring-inset ring-border">
      {items.map((item) => (
        <span key={item} className={`rounded-[9px] px-3 py-1.5 text-[12.5px] font-[650] ${item === active ? "bg-surface text-textPrimary shadow-subtle" : "text-textSecondary"}`}>
          {item}
        </span>
      ))}
    </div>
  );
}

function PanelTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 px-3.5 pb-2 pt-3">
      <p className="font-display text-[16px] font-semibold tracking-tight">{children}</p>
      {right}
    </div>
  );
}

// ── Inicio ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export function ScreenInicio() {
  return (
    <MockApp active="inicio">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[12px] font-[650] text-textMuted">Miércoles, 14 de octubre</p>
          <p className="font-display text-[26px] font-medium leading-tight tracking-[-0.025em]">
            Buenas tardes, <em className="font-normal text-accentDark">Docente</em>
          </p>
        </div>
        <span className="inline-flex h-9 items-center gap-1.5 rounded-md bg-accent px-3.5 text-[12.5px] font-bold text-white">
          <PlusIcon className="h-4 w-4" />
          Nueva clase
        </span>
      </div>
      <div className="mt-3 flex divide-x divide-border border-y border-border py-2.5">
        <Figure value="6" label="clases hoy" />
        <Figure value="2" label="por registrar" />
        <Figure value="3" label="recordatorios" />
      </div>
      <div className="tf-mk-two mt-3.5">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex min-h-[78px] items-center justify-between gap-3 rounded-[12px] bg-side px-4 py-3 text-white">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-sideText">Próxima clase</p>
              <p className="mt-1 flex flex-wrap items-baseline gap-x-3">
                <span className="font-display text-[24px] font-medium leading-none tf-num">11:30</span>
                <span className="font-display text-[16px] font-semibold">Grupo B2 · 3 alumnos</span>
              </p>
              <p className="mt-1 text-[12px] text-sideText">Presencial · Empieza en 40 min</p>
            </div>
            <span className="flex shrink-0 items-center gap-1 text-[12.5px] font-[650]">
              Ver detalle <ArrowRightIcon className="h-3.5 w-3.5" />
            </span>
          </div>
          <div className={PANEL}>
            <PanelTitle right={<span className="text-[12px] text-textMuted">6 clases</span>}>Tu día</PanelTitle>
            <ul className="pb-1.5">
              {DAY_LESSONS.slice(0, 5).map((lesson) => (
                <DayRow key={lesson.time + lesson.title} lesson={lesson} />
              ))}
            </ul>
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <div className={PANEL}>
            <PanelTitle right={<NotificationBadge count={2} />}>Clases por registrar</PanelTitle>
            {[
              ["Sofía Ibarra", "lun 12 oct · 10:00"],
              ["Mateo Sosa", "lun 12 oct · 15:00"],
            ].map(([name, when]) => (
              <div key={name} className="flex items-center justify-between gap-2 border-t border-border px-3.5 py-2">
                <div className="min-w-0">
                  <p className="tf-name text-[13px] font-bold leading-tight">{name}</p>
                  <p className="text-[12px] text-textMuted tf-num">{when}</p>
                </div>
                <ChevronRightIcon className="h-4 w-4 shrink-0 text-textMuted" />
              </div>
            ))}
          </div>
          <div className={PANEL}>
            <PanelTitle>Cobros de hoy</PanelTitle>
            <div className="grid grid-cols-2 divide-x divide-border border-t border-border">
              <div className="px-3.5 py-2.5">
                <p className="font-display text-[22px] leading-none tf-num">1</p>
                <p className="mt-1 text-[12px] font-medium text-textMuted">vence hoy</p>
              </div>
              <div className="px-3.5 py-2.5">
                <p className="font-display text-[22px] leading-none text-bad tf-num">1</p>
                <p className="mt-1 text-[12px] font-medium text-textMuted">vencido</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </MockApp>
  );
}

function stateTone(state: NonNullable<DemoDayLesson["state"]>): BadgeTone {
  return state === "En curso" ? "accent" : state === "Sigue" || state === "Cancelada" ? "warn" : "neutral";
}

function DayRow({ lesson }: { lesson: DemoDayLesson }) {
  const cancelled = lesson.state === "Cancelada";
  return (
    <li className="grid grid-cols-[3.4rem_minmax(0,1fr)] items-center gap-x-3 px-3.5 py-1.5">
      <span className={`font-display text-[15px] font-semibold tf-num ${cancelled || lesson.state === "Pasada" ? "text-textSecondary" : ""}`}>{lesson.time}</span>
      <span className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="min-w-0">
          <span className={`tf-name text-[13.5px] font-bold leading-tight ${cancelled ? "text-textSecondary line-through" : ""}`}>{lesson.title}</span>
          <span className="block text-[12px] text-textMuted">{MODALITY_LABELS[lesson.modality]}</span>
        </span>
        {lesson.state && <Badge tone={stateTone(lesson.state)}>{lesson.state}</Badge>}
      </span>
    </li>
  );
}

// ── Calendario ──────────────────────────────────────────────────────────────────────────────────────────────────────

const HOUR_PX = 44;

function lessonPalette(lesson: DemoLesson): { bg: string; border: string; text: string; sub: string } {
  if (lesson.kind === "elapsed") return { bg: ELAPSED_COLORS.bg, border: ELAPSED_COLORS.border, text: ELAPSED_COLORS.textPrimary, sub: ELAPSED_COLORS.textSecondary };
  if (lesson.kind === "cancelled") return { bg: CANCELLED_COLORS.bg, border: CANCELLED_COLORS.border, text: CANCELLED_COLORS.textPrimary, sub: CANCELLED_COLORS.textSecondary };
  if (lesson.kind === "replacement") return { bg: REPLACEMENT_COLORS.bg, border: REPLACEMENT_COLORS.border, text: CARD_TEXT_COLORS.primary, sub: CARD_TEXT_COLORS.secondary };
  const colors = MODALITY_COLORS[lesson.modality];
  return { bg: colors.bg, border: colors.border, text: CARD_TEXT_COLORS.primary, sub: CARD_TEXT_COLORS.secondary };
}

const KIND_LABEL: Partial<Record<DemoLesson["kind"], string>> = { cancelled: "Cancelada", replacement: "Reemplazo", rescheduled: "Reprogramada" };

export function WeekGrid({ highlight }: { highlight?: { day: number; start: number } }) {
  const hours = Array.from({ length: WEEK_HOURS }, (_, index) => WEEK_FIRST_HOUR + index);
  return (
    <div className={`${PANEL} overflow-hidden`}>
      <div className="tf-mk-week border-b border-border bg-surface2 text-[12px] font-[650] text-textSecondary">
        <span />
        {WEEK_DAYS.map((day, index) => (
          <span key={day.short} className={`px-1.5 py-2 text-center ${index >= 3 ? "tf-mk-md" : ""} ${index === 0 ? "text-accentDark" : ""}`}>
            {day.short} <span className="tf-num">{day.date}</span>
          </span>
        ))}
      </div>
      <div className="tf-mk-week">
        <div>
          {hours.map((hour) => (
            <p key={hour} style={{ height: HOUR_PX }} className="pr-1.5 pt-0.5 text-right text-[11px] text-textMuted tf-num">
              {hour}:00
            </p>
          ))}
        </div>
        {WEEK_DAYS.map((day, dayIndex) => (
          <div
            key={day.short}
            className={`relative border-l border-border ${dayIndex >= 3 ? "tf-mk-md" : ""}`}
            style={{ height: HOUR_PX * WEEK_HOURS, backgroundImage: "linear-gradient(to bottom, #E6DAC4 1px, transparent 1px)", backgroundSize: `100% ${HOUR_PX}px` }}
          >
            {dayIndex === 0 && <span className="absolute inset-x-0 z-10 h-[2px]" style={{ top: (10.35 - WEEK_FIRST_HOUR) * HOUR_PX, background: CURRENT_TIME_COLOR }} />}
            {WEEK_LESSONS.filter((lesson) => lesson.day === dayIndex).map((lesson) => {
              const palette = lessonPalette(lesson);
              const label = KIND_LABEL[lesson.kind];
              const lifted = highlight && highlight.day === lesson.day && highlight.start === lesson.start;
              return (
                <div
                  key={`${lesson.day}-${lesson.start}`}
                  className={`absolute inset-x-[3px] overflow-hidden rounded-[6px] px-1.5 py-[3px] leading-tight ${lifted ? "z-20 ring-2 ring-ink ring-offset-1" : ""}`}
                  style={{ top: (lesson.start - WEEK_FIRST_HOUR) * HOUR_PX + 1, height: lesson.hours * HOUR_PX - 2, background: palette.bg, borderLeft: `3px solid ${palette.border}`, color: palette.text }}
                >
                  <p className={`text-[11.5px] font-bold ${lesson.kind === "cancelled" ? "line-through" : ""}`}>{lesson.title}</p>
                  <p className="text-[11px]" style={{ color: palette.sub }}>
                    {label ?? MODALITY_LABELS[lesson.modality]}
                  </p>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ScreenCalendarioSemana({ highlight }: { highlight?: { day: number; start: number } }) {
  return (
    <MockApp active="calendario">
      <MockHeader
        title="Calendario"
        right={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented items={["Semana", "Día"]} active="Semana" />
            <span className="inline-flex items-center gap-1 text-[13px] font-[650]">
              <ChevronLeftIcon className="h-4 w-4" /> octubre 2026 <ChevronRightIcon className="h-4 w-4" />
            </span>
          </div>
        }
      />
      <div className="mt-3">
        <WeekGrid highlight={highlight} />
      </div>
      <ModalityLegend />
    </MockApp>
  );
}

export function ModalityLegend() {
  return (
    <p className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-textSecondary">
      {(["online", "presencial", "mixta"] as LessonModality[]).map((modality) => (
        <span key={modality} className="inline-flex items-center gap-1.5">
          <i className="block h-3 w-3 rounded-[3px]" style={{ background: MODALITY_COLORS[modality].bg, border: `1.5px solid ${MODALITY_COLORS[modality].border}` }} />
          {MODALITY_LABELS[modality]}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <i className="block h-3 w-3 rounded-[3px]" style={{ background: CANCELLED_COLORS.bg, border: `1.5px solid ${CANCELLED_COLORS.border}` }} />
        Cancelada
      </span>
      <span className="inline-flex items-center gap-1.5">
        <i className="block h-3 w-3 rounded-[3px]" style={{ background: REPLACEMENT_COLORS.bg, border: `1.5px solid ${REPLACEMENT_COLORS.border}` }} />
        Reemplazo
      </span>
    </p>
  );
}

export function ScreenCalendarioDia({ limit = DAY_LESSONS.length }: { limit?: number }) {
  return (
    <MockApp active="calendario">
      <MockHeader
        title="Calendario"
        right={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented items={["Semana", "Día"]} active="Día" />
            <span className="inline-flex items-center gap-1 text-[13px] font-[650]">
              <ChevronLeftIcon className="h-4 w-4" /> lun 12 oct <ChevronRightIcon className="h-4 w-4" />
            </span>
          </div>
        }
      />
      <ol className="mt-3 flex flex-col gap-2">
        {DAY_LESSONS.slice(0, limit).map((lesson) => {
          const cancelled = lesson.state === "Cancelada";
          const past = lesson.state === "Pasada";
          const colors = cancelled ? CANCELLED_COLORS : past ? ELAPSED_COLORS : MODALITY_COLORS[lesson.modality];
          return (
            <li key={lesson.time} className="grid grid-cols-[3.2rem_minmax(0,1fr)] items-stretch gap-2.5">
              <span className="pt-2 text-right font-display text-[15px] font-semibold tf-num">{lesson.time}</span>
              <span className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-[8px] px-3 py-2" style={{ background: colors.bg, borderLeft: `4px solid ${colors.border}`, color: CARD_TEXT_COLORS.primary }}>
                <span className="min-w-0">
                  <span className={`block text-[13.5px] font-bold leading-tight ${cancelled ? "line-through" : ""}`}>{lesson.title}</span>
                  <span className="block text-[12px]" style={{ color: CARD_TEXT_COLORS.secondary }}>
                    {MODALITY_LABELS[lesson.modality]} · hasta {lesson.end}
                  </span>
                </span>
                {lesson.state && <Badge tone={stateTone(lesson.state)}>{lesson.state}</Badge>}
              </span>
            </li>
          );
        })}
      </ol>
    </MockApp>
  );
}

// ── Alumnos ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const STUDENT_ROWS: { index: number; next: string; pay: DemoChargeState }[] = [
  { index: 0, next: "mié 14/10 · 09:00", pay: "Pagado" },
  { index: 1, next: "lun 12/10 · 15:00", pay: "Vence hoy" },
  { index: 2, next: "mar 13/10 · 10:00", pay: "Vence pronto" },
  { index: 3, next: "mar 13/10 · 15:30", pay: "Pago parcial" },
  { index: 4, next: "mié 14/10 · 09:00", pay: "Pagado" },
  { index: 5, next: "mié 14/10 · 11:30", pay: "Vencido" },
];

export function ScreenAlumnos() {
  return (
    <MockApp active="alumnos">
      <MockHeader title="Alumnos" sub="6 alumnos activos" right={<span className="inline-flex h-9 items-center gap-1.5 rounded-md bg-accent px-3.5 text-[12.5px] font-bold text-white"><PlusIcon className="h-4 w-4" />Nuevo alumno</span>} />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-md border-[1.5px] border-borderStrong bg-surface px-3 text-[13px] text-textMuted">
          <MagnifyingGlassIcon className="h-4 w-4 shrink-0" /> Buscar por nombre
        </span>
        <Segmented items={["Activos", "Todos"]} active="Activos" />
      </div>
      <ul className={`${PANEL} mt-3 overflow-hidden`}>
        {STUDENT_ROWS.map(({ index, next, pay }) => {
          const student = DEMO_STUDENTS[index];
          return (
            <li key={student.name} className="flex items-center gap-3 border-b border-border px-3.5 py-2.5 last:border-b-0">
              <Avatar initial={student.name[0]} tone={student.tone} size="m" />
              <span className="min-w-0 flex-1">
                <span className="tf-name text-[13.5px] font-bold leading-tight">{student.name}</span>
                <span className="block text-[12px] text-textMuted">
                  Nivel {student.level} · {MODALITY_LABELS[student.modality]}
                </span>
              </span>
              <span className="tf-mk-md w-[116px] shrink-0 text-[12px] text-textSecondary tf-num">{next}</span>
              <Badge tone={CHARGE_TONE[pay]}>{pay}</Badge>
            </li>
          );
        })}
      </ul>
    </MockApp>
  );
}

// ── Perfil ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export type ProfileTab = "Resumen" | "Clases" | "Progreso" | "Tareas" | "Cobros" | "Reportes" | "Información";
const PROFILE_TABS: readonly ProfileTab[] = ["Resumen", "Clases", "Progreso", "Tareas", "Cobros", "Reportes", "Información"];

function ProfileBody({ tab }: { tab: ProfileTab }) {
  if (tab === "Clases") {
    return (
      <ul className={`${PANEL} mt-3 overflow-hidden`}>
        {DEMO_HISTORY.map((entry) => (
          <li key={entry.date} className="flex items-center gap-3 border-b border-border px-3.5 py-2.5 last:border-b-0">
            <span className="w-[68px] shrink-0 text-[12.5px] font-[650] tf-num">{entry.date}</span>
            <span className="min-w-0 flex-1 text-[13px] leading-snug">{entry.note}</span>
            <Badge tone={entry.state === "Dictada" ? "ok" : "neutral"}>{entry.state}</Badge>
          </li>
        ))}
      </ul>
    );
  }
  if (tab === "Cobros") {
    return (
      <div className="mt-3 flex flex-col gap-3">
        <div className={PANEL}>
          <PanelTitle right={<Badge tone="ok">Al día</Badge>}>Obligaciones</PanelTitle>
          <div className="flex items-center justify-between gap-3 border-t border-border px-3.5 py-2.5">
            <span>
              <span className="block text-[13px] font-bold">Mensualidad octubre</span>
              <span className="block text-[12px] text-textMuted">Vence 10/10/2026</span>
            </span>
            <span className="text-right">
              <span className="block text-[13px] font-bold tf-num">{formatMoney(48000)}</span>
              <Badge tone="ok" icon={<CheckCircleIcon className="h-3.5 w-3.5" />}>Pagado</Badge>
            </span>
          </div>
        </div>
        <div className={PANEL}>
          <PanelTitle>Pagos registrados</PanelTitle>
          <div className="flex items-center justify-between gap-3 border-t border-border px-3.5 py-2.5 text-[13px]">
            <span className="tf-num">08/10/2026</span>
            <span className="font-bold tf-num">{formatMoney(48000)}</span>
          </div>
        </div>
      </div>
    );
  }
  if (tab === "Reportes") {
    return (
      <div className="mt-3 flex flex-col gap-3">
        <div className={`${PANEL} p-3.5`}>
          <p className="font-display text-[16px] font-semibold">Generar reporte</p>
          <p className="mt-1 text-[12.5px] text-textSecondary">Resumen de clases, progreso y tareas del período, listo para compartir en PDF.</p>
          <span className="mt-3 inline-flex h-9 items-center rounded-md bg-ink px-3.5 text-[12.5px] font-bold text-white">Generar PDF</span>
        </div>
        <div className={PANEL}>
          <PanelTitle>Historial de reportes</PanelTitle>
          <div className="flex items-center justify-between gap-3 border-t border-border px-3.5 py-2.5 text-[13px]">
            <span>Reporte de septiembre</span>
            <span className="text-[12.5px] font-[650] text-accentDark">Ver / Descargar</span>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="mt-3 flex flex-col gap-3">
      <div className="flex divide-x divide-border border-y border-border py-2.5">
        <Figure value="24" label="clases dictadas" />
        <Figure value="2" label="por registrar" />
        <Figure value="Al día" label="cobros" tone="text-ok" />
      </div>
      <div className="tf-mk-cols">
        <div className={`${PANEL} p-3.5`}>
          <p className="text-[11.5px] font-bold uppercase tracking-[0.09em] text-textMuted">Próxima clase</p>
          <p className="mt-1 font-display text-[18px] font-semibold">Mié 14/10 · 09:00</p>
          <p className="text-[12.5px] text-textSecondary">Presencial · 1 h</p>
        </div>
        <div className={`${PANEL} p-3.5`}>
          <p className="text-[11.5px] font-bold uppercase tracking-[0.09em] text-textMuted">Última clase</p>
          <p className="mt-1 text-[13px] leading-snug">Present perfect: ejercicios 1 a 4. Tarea: leer el capítulo 3.</p>
        </div>
      </div>
    </div>
  );
}

export function ScreenPerfil({ tab = "Resumen", framed = true }: { tab?: ProfileTab; framed?: boolean }) {
  const student = DEMO_STUDENTS[0];
  const content = (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Avatar initial="L" tone={student.tone} size="l" />
        <div className="min-w-0 flex-1">
          <p className="tf-name font-display text-[22px] font-medium leading-tight tracking-[-0.02em]">{student.name}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[12.5px] text-textSecondary">
            Nivel {student.level} · Presencial <Badge tone="ok">Activo</Badge>
          </p>
        </div>
      </div>
      <div className="mt-3 flex gap-1 overflow-hidden border-b border-border text-[12.5px] font-[650]">
        {PROFILE_TABS.map((item) => (
          <span key={item} className={`shrink-0 border-b-2 px-2.5 py-2 ${item === tab ? "border-accent text-accentDark" : "border-transparent text-textSecondary"}`}>
            {item}
          </span>
        ))}
      </div>
      <ProfileBody tab={tab} />
    </>
  );
  return framed ? <MockApp active="alumnos">{content}</MockApp> : <div className="tf-mk bg-background px-3.5 pb-4 pt-3.5">{content}</div>;
}

// ── Cobros y resumen ────────────────────────────────────────────────────────────────────────────────────────────────

export function ChargeRows({ limit = 5 }: { limit?: number }) {
  return (
    <ul className={`${PANEL} overflow-hidden`}>
      {DEMO_CHARGES.slice(0, limit).map((charge) => (
        <li key={charge.student} className="flex items-center gap-3 border-b border-border px-3.5 py-2.5 last:border-b-0">
          <Avatar initial={charge.student[0]} tone={charge.tone} size="m" />
          <span className="min-w-0 flex-1">
            <span className="tf-name text-[13.5px] font-bold leading-tight">{charge.student}</span>
            <span className="block text-[12px] text-textMuted">
              {charge.concept} · vence <span className="tf-num">{charge.due}</span>
            </span>
          </span>
          <span className="shrink-0 text-right">
            <span className="block text-[13.5px] font-bold tf-num">{formatMoney(charge.balance > 0 ? charge.balance : charge.amount)}</span>
            <Badge tone={CHARGE_TONE[charge.state]}>{charge.state}</Badge>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ScreenCobros() {
  return (
    <MockApp active="cobros">
      <MockHeader title="Cobros" sub="Octubre 2026" right={<Segmented items={["Cobros", "Resumen financiero"]} active="Cobros" />} />
      <div className="mt-3 flex divide-x divide-border border-y border-border py-2.5">
        <Figure value={formatMoney(144000)} label="pendiente de cobro" />
        <Figure value="1" label="vencido" tone="text-bad" />
        <Figure value="2" label="vencen esta semana" />
      </div>
      <div className="mt-3">
        <ChargeRows />
      </div>
      <ul className={`${PANEL} mt-3 overflow-hidden`}>
        <li className="px-3.5 pb-1 pt-3 font-display text-[16px] font-semibold tracking-tight">Pagos registrados</li>
        {DEMO_PAYMENTS.slice(0, 2).map((payment) => (
          <li key={payment.student} className="flex items-center justify-between gap-3 border-t border-border px-3.5 py-2 text-[13px]">
            <span className="tf-name">
              <b className="font-bold">{payment.student}</b> <span className="text-textMuted tf-num">· {payment.date}</span>
            </span>
            <span className="font-bold text-ok tf-num">{formatMoney(payment.amount)}</span>
          </li>
        ))}
      </ul>
    </MockApp>
  );
}

/** Dona del plan 50/30/20 (mismas proporciones y colores de datos que la pantalla real). */
export function BudgetDonut({ total, size = 132 }: { total: number; size?: number }) {
  const strokes = ["stroke-budgetNeeds", "stroke-budgetWants", "stroke-budgetSavings"];
  const offsets = DEMO_BUDGET.map((_, index) => 25 - DEMO_BUDGET.slice(0, index).reduce((sum, item) => sum + item.percent, 0));
  return (
    <div className="shrink-0">
      <div className="relative" style={{ width: size, height: size }}>
        <svg viewBox="0 0 36 36" className="h-full w-full">
          <circle cx="18" cy="18" r="15.9155" fill="none" strokeWidth="4.2" className="stroke-paperDeep" />
          {DEMO_BUDGET.map((item, index) => (
            <circle key={item.key} cx="18" cy="18" r="15.9155" fill="none" strokeWidth="4.2" strokeDasharray={`${item.percent - 0.6} ${100 - item.percent + 0.6}`} strokeDashoffset={offsets[index]} className={strokes[index]} />
          ))}
        </svg>
        {/* Escritorio: el importe va en el centro. En móvil el aro es chico: el importe pasa debajo (ver .tf-donut-caption). */}
        <div className="tf-donut-center absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-[11px] font-[650] text-textMuted">Cobrado</span>
          <span className="font-display text-[15px] font-semibold leading-tight tf-num">{formatMoney(total)}</span>
        </div>
      </div>
      <p className="tf-donut-caption mt-1.5 text-center text-[12px] font-[650] text-textMuted" style={{ width: size }}>
        Cobrado <span className="font-display text-[14px] font-semibold text-textPrimary tf-num">{formatMoney(total)}</span>
      </p>
    </div>
  );
}

export function BudgetLegend({ total }: { total: number }) {
  const swatches = ["bg-budgetNeeds", "bg-budgetWants", "bg-budgetSavings"];
  return (
    <ul className="min-w-[210px] flex-1 space-y-1.5 text-[13px]">
      {DEMO_BUDGET.map((item, index) => (
        <li key={item.key} className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-2 whitespace-nowrap font-[650]">
            <i className={`block h-2.5 w-2.5 rounded-[3px] ${swatches[index]}`} />
            {item.label} <span className="font-normal text-textMuted tf-num">{item.percent} %</span>
          </span>
          <span className="font-bold tf-num">{formatMoney((total * item.percent) / 100)}</span>
        </li>
      ))}
    </ul>
  );
}

export function MiniBars({ height = 96 }: { height?: number }) {
  const max = Math.max(...DEMO_COLLECTED.map((point) => point.amount));
  const months = ["may", "jun", "jul", "ago", "sep", "oct"];
  return (
    <div>
      <div className="flex items-end gap-2 border-b-[1.5px] border-borderMid" style={{ height }}>
        {DEMO_COLLECTED.map((point) => (
          <span key={point.month} className="block flex-1 rounded-t-md bg-ok" style={{ height: `${Math.round((point.amount / max) * 100)}%` }} />
        ))}
      </div>
      <div className="mt-1 flex gap-2 text-center text-[11.5px] font-medium text-textMuted">
        {months.map((month) => (
          <span key={month} className="flex-1">
            {month}
          </span>
        ))}
      </div>
    </div>
  );
}

export function ScreenResumen() {
  return (
    <MockApp active="cobros">
      <MockHeader title="Resumen financiero" sub="Lo efectivamente cobrado" right={<Segmented items={["Cobros", "Resumen financiero"]} active="Resumen financiero" />} />
      <div className="tf-mk-cols mt-3">
        <div className={`${PANEL} p-3.5`}>
          <p className="font-display text-[16px] font-semibold tracking-tight">Evolución de cobros</p>
          <p className="mb-2.5 text-[12px] text-textMuted">Últimos 6 meses · mayor cobro: septiembre</p>
          <MiniBars />
        </div>
        <div className={`${PANEL} p-3.5`}>
          <p className="font-display text-[16px] font-semibold tracking-tight">Distribución sugerida</p>
          <p className="mb-2.5 text-[12px] text-textMuted">Proyección sobre lo cobrado</p>
          <div className="flex flex-wrap items-center gap-3">
            <BudgetDonut total={DEMO_COLLECTED_THIS_MONTH} size={112} />
            <BudgetLegend total={DEMO_COLLECTED_THIS_MONTH} />
          </div>
        </div>
      </div>
      <p className="mt-3 rounded-md border-[1.5px] border-border bg-surface2 px-3 py-2 text-[12px] text-textSecondary">
        Es una proyección orientativa: TeacherFlow no conoce tus gastos ni tu ahorro real.
      </p>
    </MockApp>
  );
}
