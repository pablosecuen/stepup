"use client";

import { XMarkIcon } from "@heroicons/react/24/outline";
import type { CalendarFixtureLesson } from "@/lib/calendar-fixtures";
import { MODALITY_LABELS, STATUS_LABELS } from "@/lib/calendar-theme";

interface LessonDetailModalProps {
  lesson: CalendarFixtureLesson;
  start: Date;
  onClose: () => void;
}

function MetaChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-textSecondary">
      {children}
    </span>
  );
}

/**
 * Réplica del panel de detalle de CalendarLessonActionsSheet.tsx (móvil):
 * encabezado con título + chips de metadatos, sección de alumnos, y una
 * lista de acciones — acá todas deshabilitadas y marcadas "(demo)", porque
 * esta vista previa nunca guarda cambios reales.
 */
export function LessonDetailModal({ lesson, start, onClose }: LessonDetailModalProps) {
  const dateLabel = start.toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const timeLabel = start.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
  const participantNames = Array.from({ length: lesson.participantCount }, (_, i) => `Alumno de ejemplo ${i + 1}`);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="lesson-detail-title"
        className="max-h-[85vh] w-full max-w-md animate-[modal-in_0.2s_cubic-bezier(0.22,1,0.36,1)] overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-panel sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="lesson-detail-title" className="text-lg font-bold text-textPrimary">
            {lesson.title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar detalle de la clase"
            className="rounded-full p-1.5 text-textMuted transition-all duration-150 ease-premium hover:bg-background hover:text-textPrimary active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-1.5">
          <MetaChip>{dateLabel}</MetaChip>
          <MetaChip>{timeLabel}</MetaChip>
          <MetaChip>{lesson.durationMinutes} min</MetaChip>
          <MetaChip>{MODALITY_LABELS[lesson.modality]}</MetaChip>
          <MetaChip>{lesson.isRecurring ? "Serie recurrente" : "Clase suelta"}</MetaChip>
          <MetaChip>{STATUS_LABELS[lesson.status]}</MetaChip>
          {lesson.activityKind === "training" && <MetaChip>Entrenamiento</MetaChip>}
        </div>

        <section className="mt-5">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-textSecondary">
            {participantNames.length === 1 ? "Alumno" : `Alumnos (${participantNames.length})`}
          </h3>
          <ul className="mt-2 flex flex-col gap-1.5">
            {participantNames.map((name) => (
              <li key={name} className="rounded-md border border-border px-3 py-2 text-sm text-textPrimary">
                {name}
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-5">
          <div className="mb-2 rounded-md bg-brandBlue/5 px-3 py-2 text-xs font-medium text-brandBlueDark">
            Vista previa — estas acciones todavía no guardan cambios reales.
          </div>
          <div className="flex flex-col gap-1.5">
            {[
              "Editar nombre de la clase",
              "Cambiar duración",
              "Cambiar tipo de actividad",
              "Reprogramar esta clase",
            ].map((action) => (
              <button
                key={action}
                type="button"
                disabled
                aria-disabled="true"
                className="flex cursor-not-allowed items-center justify-between rounded-md border border-border px-3 py-2.5 text-left text-sm font-medium text-textMuted opacity-60"
              >
                {action}
                <span className="rounded-pill bg-background px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                  Demo
                </span>
              </button>
            ))}
          </div>
        </section>

        <button
          type="button"
          onClick={onClose}
          className="mt-5 w-full rounded-md bg-brandBlue px-4 py-2.5 text-sm font-semibold text-white transition-all duration-150 ease-premium hover:bg-brandBlueDark active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue focus-visible:ring-offset-2"
        >
          Cerrar
        </button>
      </div>
    </div>
  );
}
