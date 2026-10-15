import { ArrowRightIcon, BellIcon, CalendarDaysIcon, CheckCircleIcon, ClipboardDocumentCheckIcon, ClockIcon, DocumentTextIcon, LockClosedIcon } from "@heroicons/react/24/outline";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { FloatCard } from "@/components/landing/frame";
import { formatMoney } from "@/lib/format/number-format";
import { MODALITY_COLORS } from "@/lib/calendar-theme";

/** Ventanas emergentes de las maquetas: una acción concreta cada una, con datos sintéticos. Exclusivamente demostrativas. */

type P = { className?: string };

export function FloatNextClass({ className }: P) {
  return (
    <FloatCard eyebrow="Próxima clase" tone="dark" icon={<ClockIcon className="h-3.5 w-3.5" />} className={className}>
      <p className="flex items-baseline gap-3">
        <span className="font-display text-[28px] font-medium leading-none tf-num">11:30</span>
        <span className="font-display text-[16px] font-semibold leading-tight">Grupo B2</span>
      </p>
      <p className="mt-1.5 text-[12.5px] text-sideText">Presencial · Empieza en 40 min</p>
      <p className="mt-2 flex items-center gap-1 text-[12.5px] font-[650]">
        Ver detalle <ArrowRightIcon className="h-3.5 w-3.5" />
      </p>
    </FloatCard>
  );
}

export function FloatPaymentReceived({ className }: P) {
  return (
    <FloatCard eyebrow="Cobro recibido" icon={<CheckCircleIcon className="h-3.5 w-3.5 text-ok" />} className={className}>
      <p className="flex items-center gap-2.5">
        <Avatar initial="V" tone={4} size="m" />
        <span className="min-w-0">
          <span className="block text-[13.5px] font-bold leading-tight">Valentina Rey</span>
          <span className="block text-[12px] text-textMuted">Mensualidad octubre</span>
        </span>
      </p>
      <p className="mt-2 flex items-center justify-between gap-2">
        <span className="font-display text-[22px] font-semibold leading-none text-ok tf-num">{formatMoney(60000)}</span>
        <Badge tone="ok" icon={<CheckCircleIcon className="h-3.5 w-3.5" />}>Pagado</Badge>
      </p>
    </FloatCard>
  );
}

export function FloatToRegister({ className }: P) {
  return (
    <FloatCard eyebrow="Clase por registrar" icon={<ClipboardDocumentCheckIcon className="h-3.5 w-3.5" />} className={className}>
      <p className="text-[13.5px] font-bold leading-tight">Sofía Ibarra</p>
      <p className="text-[12px] text-textMuted tf-num">lun 12/10 · 10:00 · Mixta</p>
      <p className="mt-2.5 inline-flex h-9 items-center rounded-md bg-accent px-3.5 text-[12.5px] font-bold text-white">Registrar clase</p>
    </FloatCard>
  );
}

export function FloatReminder({ className }: P) {
  return (
    <FloatCard eyebrow="Recordatorio" icon={<BellIcon className="h-3.5 w-3.5" />} className={className}>
      <p className="text-[13.5px] font-bold leading-snug">2 pagos próximos a vencer</p>
      <p className="mt-0.5 text-[12px] text-textMuted">Mateo S. vence hoy · Sofía I. vence el jueves</p>
      <p className="mt-2 flex items-center gap-1 text-[12.5px] font-[650] text-accentDark">
        Ver recordatorios <ArrowRightIcon className="h-3.5 w-3.5" />
      </p>
    </FloatCard>
  );
}

export function FloatStudent({ className }: P) {
  return (
    <FloatCard eyebrow="Detalle de alumno" className={className}>
      <p className="flex items-center gap-2.5">
        <Avatar initial="L" tone={0} size="l" />
        <span className="min-w-0">
          <span className="block text-[14px] font-bold leading-tight">Lucía Ferrer</span>
          <span className="block text-[12px] text-textMuted">Nivel B1 · Presencial</span>
        </span>
      </p>
      <p className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge tone="ok">Activo</Badge>
        <Badge tone="ok">Al día</Badge>
      </p>
      <p className="mt-2 text-[12.5px] text-textSecondary">Próxima clase: mié 14/10 · 09:00</p>
    </FloatCard>
  );
}

export function FloatReschedule({ className }: P) {
  return (
    <FloatCard eyebrow="Reprogramar clase" icon={<CalendarDaysIcon className="h-3.5 w-3.5" />} className={className}>
      <p className="text-[13.5px] font-bold leading-tight">Lucía Ferrer</p>
      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 text-[12.5px]">
        <span className="rounded-md bg-paperDeep px-2.5 py-1.5 text-textSecondary tf-num">
          <span className="block text-[11px] text-textMuted">Antes</span>mié 14/10 · 09:00
        </span>
        <ArrowRightIcon className="h-4 w-4 text-textMuted" />
        <span className="rounded-md border-[1.5px] border-accentLine bg-accentSoft px-2.5 py-1.5 font-[650] text-accentText tf-num">
          <span className="block text-[11px] font-medium">Ahora</span>jue 15/10 · 10:00
        </span>
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-[12px] text-ok">
        <CheckCircleIcon className="h-4 w-4 shrink-0" /> Sin choques con otras clases ni bloqueos
      </p>
      <p className="mt-2.5 inline-flex h-9 items-center rounded-md bg-ink px-3.5 text-[12.5px] font-bold text-white">Confirmar horario</p>
    </FloatCard>
  );
}

export function FloatSeries({ className }: P) {
  const days = ["L", "M", "X", "J", "V", "S", "D"];
  const on = new Set(["L", "J"]);
  return (
    <FloatCard eyebrow="Serie de clases" icon={<CalendarDaysIcon className="h-3.5 w-3.5" />} className={className}>
      <p className="text-[13.5px] font-bold leading-tight">Lucía Ferrer · semanal</p>
      <p className="mt-2 flex gap-1.5" aria-hidden>
        {days.map((day) => (
          <span key={day} className={`flex h-8 w-8 items-center justify-center rounded-full border-[1.5px] text-[12px] font-bold ${on.has(day) ? "border-accent bg-accent text-white" : "border-borderMid text-textSecondary"}`}>
            {day}
          </span>
        ))}
      </p>
      <p className="mt-2 text-[12.5px] text-textSecondary">Lunes y jueves · 09:00 a 10:00 · Presencial</p>
      <p className="mt-0.5 text-[12px] text-textMuted">Cada clase queda en el Calendario</p>
    </FloatCard>
  );
}

export function FloatAvailability({ className }: P) {
  return (
    <FloatCard eyebrow="Disponibilidad" icon={<LockClosedIcon className="h-3.5 w-3.5" />} className={className}>
      <p className="text-[12px] font-[650] text-textMuted">Bloqueos semanales</p>
      <ul className="mt-1 space-y-1 text-[12.5px]">
        <li className="flex items-center justify-between gap-2 rounded-md bg-paperDeep px-2.5 py-1.5">
          <span className="font-[650]">Almuerzo</span>
          <span className="tf-num text-textSecondary">Lun a vie · 13:00–14:30</span>
        </li>
        <li className="flex items-center justify-between gap-2 rounded-md bg-paperDeep px-2.5 py-1.5">
          <span className="font-[650]">Sin clases</span>
          <span className="tf-num text-textSecondary">Sáb y dom</span>
        </li>
      </ul>
      <p className="mt-2 text-[12px] font-[650] text-textMuted">Excepciones</p>
      <p className="mt-1 flex items-center justify-between gap-2 rounded-md border-[1.5px] border-warnLine bg-warnSoft px-2.5 py-1.5 text-[12.5px] text-warn">
        <span className="font-[650]">Vacaciones</span>
        <span className="tf-num">21/12 al 04/01</span>
      </p>
    </FloatCard>
  );
}

export function FloatOpenLesson({ className }: P) {
  const colors = MODALITY_COLORS.presencial;
  return (
    <FloatCard eyebrow="Clase abierta" className={className}>
      <div className="rounded-md px-3 py-2" style={{ background: colors.bg, borderLeft: `4px solid ${colors.border}` }}>
        <p className="text-[14px] font-bold leading-tight">Lucía Ferrer</p>
        <p className="text-[12px] text-textSecondary tf-num">Mié 14/10 · 09:00 a 10:00 · Presencial</p>
      </div>
      <div className="mt-2.5 flex flex-col gap-1.5 text-[12.5px] font-[650]">
        <span className="flex h-9 items-center justify-center rounded-md bg-accent text-white">Registrar clase</span>
        <span className="flex h-9 items-center justify-center rounded-md border-[1.5px] border-borderStrong bg-surface">Reprogramar esta clase</span>
        <span className="flex h-9 items-center justify-center rounded-md border-[1.5px] border-borderStrong bg-surface text-bad">Cancelar clase</span>
      </div>
    </FloatCard>
  );
}

export function FloatRegisterPayment({ className }: P) {
  return (
    <FloatCard eyebrow="Registrar pago" icon={<CheckCircleIcon className="h-3.5 w-3.5" />} className={className}>
      <p className="text-[13.5px] font-bold leading-tight">Mateo Sosa · Mensualidad octubre</p>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[12.5px]">
        <span className="rounded-md border-[1.5px] border-borderStrong bg-surface px-2.5 py-1.5">
          <span className="block text-[11px] text-textMuted">Importe</span>
          <b className="tf-num">{formatMoney(42000)}</b>
        </span>
        <span className="rounded-md border-[1.5px] border-borderStrong bg-surface px-2.5 py-1.5">
          <span className="block text-[11px] text-textMuted">Fecha</span>
          <b className="tf-num">12/10/2026</b>
        </span>
      </div>
      <p className="mt-2.5 inline-flex h-9 items-center rounded-md bg-accent px-3.5 text-[12.5px] font-bold text-white">Registrar pago</p>
    </FloatCard>
  );
}

export function FloatReport({ className }: P) {
  return (
    <FloatCard eyebrow="Reporte del alumno" icon={<DocumentTextIcon className="h-3.5 w-3.5" />} className={className}>
      <p className="text-[13.5px] font-bold leading-tight">Lucía Ferrer · septiembre</p>
      <p className="mt-0.5 text-[12px] text-textMuted">Clases, progreso y tareas del período</p>
      <p className="mt-2 flex items-center gap-1 text-[12.5px] font-[650] text-accentDark">
        Ver / Descargar PDF <ArrowRightIcon className="h-3.5 w-3.5" />
      </p>
    </FloatCard>
  );
}
