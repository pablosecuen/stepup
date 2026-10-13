"use client";

import { useState, type ReactNode, type Ref } from "react";
import { CheckCircleIcon, CheckIcon, ExclamationTriangleIcon, InformationCircleIcon } from "@heroicons/react/24/outline";
import type { UndoBlockedPreview } from "@/lib/backup/undo-blocked-mapping";
import { IMPORT_GLOSSARY } from "@/lib/backup/import-copy";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

// Piezas compartidas del asistente de importación y del historial: avisos con ícono (el tono nunca es sólo color), el error con
// su código de soporte, el indicador de pasos, el vocabulario y el flujo de «deshacer» (revisar → confirmar) que usan los dos.
// Las confirmaciones («deshacer», «quitar la opción de deshacer») son diálogos del sistema: hoja inferior en móvil, foco atrapado,
// Escape y devolución del foco.

type NoticeTone = "info" | "warning" | "danger" | "success";

const NOTICE_STYLE: Record<NoticeTone, { box: string; Icon: typeof InformationCircleIcon; label: string; iconClass: string }> = {
  info: { box: "border-infoLine bg-infoSoft", Icon: InformationCircleIcon, label: "Información", iconClass: "text-info" },
  warning: { box: "border-warnLine bg-warnSoft", Icon: ExclamationTriangleIcon, label: "Atención", iconClass: "text-warn" },
  danger: { box: "border-badLine bg-badSoft", Icon: ExclamationTriangleIcon, label: "Importante", iconClass: "text-bad" },
  success: { box: "border-okLine bg-okSoft", Icon: CheckCircleIcon, label: "Listo", iconClass: "text-ok" },
};

/** Aviso con ícono y una palabra («Atención», «Importante»…) que lee también un lector de pantalla. */
export function Notice({ tone = "info", title, children }: { tone?: NoticeTone; title?: string; children: ReactNode }) {
  const { box, Icon, label, iconClass } = NOTICE_STYLE[tone];
  return (
    <div className={`flex gap-3 rounded-md border-[1.5px] p-3.5 text-[14.5px] text-textSecondary ${box}`}>
      <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${iconClass}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-bold text-textPrimary">
          <span className="sr-only">{label}: </span>
          {title ?? label}
        </p>
        <div className="mt-1 flex flex-col gap-1.5">{children}</div>
      </div>
    </div>
  );
}

/**
 * Error del asistente: sólo la frase útil (qué pasó, qué pasó con los datos y qué hacer). Ningún código interno se muestra: la
 * clasificación vive en el servidor y se registra en su log seguro. «Reintentar» aparece cuando la pantalla tiene un reintento directo.
 */
export function ImportErrorBox({ message, onRetry, boxRef }: { message: string; onRetry?: () => void; boxRef?: Ref<HTMLDivElement> }) {
  return (
    <div
      ref={boxRef}
      role="alert"
      tabIndex={-1}
      className="rounded-md border-[1.5px] border-badLine bg-badSoft px-4 py-3.5 text-[14.5px] text-bad focus:outline-none focus-visible:ring-2 focus-visible:ring-bad"
    >
      <p>{message}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry} className="mt-3">
          Reintentar
        </Button>
      )}
    </div>
  );
}

const STEPS = ["Analizar", "Revisar y decidir", "Resultado"] as const;

/** «Paso 2 de 3»: la lista numerada marca el paso actual con `aria-current` y un tilde en los pasos ya hechos. */
export function StepIndicator({ current }: { current: 1 | 2 | 3 }) {
  return (
    <nav aria-label="Pasos de la importación">
      <ol className="flex flex-wrap gap-x-5 gap-y-2 text-[14.5px]">
        {STEPS.map((label, index) => {
          const number = index + 1;
          const done = number < current;
          const active = number === current;
          return (
            <li key={label} aria-current={active ? "step" : undefined} className={`flex items-center gap-2 ${active ? "font-[650] text-textPrimary" : "text-textMuted"}`}>
              <span
                aria-hidden
                className={`flex h-7 w-7 items-center justify-center rounded-full border-[1.5px] text-[13px] font-bold ${
                  active ? "border-ink bg-ink text-background" : done ? "border-ok bg-okSoft text-ok" : "border-borderStrong"
                }`}
              >
                {done ? <CheckIcon className="h-4 w-4" /> : number}
              </span>
              <span>
                <span className="sr-only">Paso {number} de 3: </span>
                {label}
                {done && <span className="sr-only"> (hecho)</span>}
                {active && <span className="sr-only"> (paso actual)</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Las cinco palabras del asistente (agregar, conservar, reemplazar, no importar, deshacer) y qué significa cada una. */
export function Glossary() {
  return (
    <dl className="flex flex-col gap-1">
      {IMPORT_GLOSSARY.map((entry) => (
        <div key={entry.term}>
          <dt className="inline font-bold text-textPrimary">{entry.term}:</dt> <dd className="inline text-textSecondary">{entry.meaning}</dd>
        </div>
      ))}
    </dl>
  );
}

function capitalize(text: string): string {
  return text.charAt(0).toLocaleUpperCase("es") + text.slice(1);
}

/**
 * Resultado de «revisar si se puede deshacer», en un diálogo: si es seguro, pide la confirmación con lo que va a pasar; si no,
 * explica por qué está bloqueado (y que no se toca nada). El foco queda atrapado y Escape cancela.
 */
export function UndoReviewPanel({
  undoState,
  pending,
  onConfirm,
  onCancel,
}: {
  undoState: UndoBlockedPreview;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      title={undoState.isSafe ? "Deshacer la importación" : "No se puede deshacer ahora"}
      size="md"
      onClose={onCancel}
      busy={pending}
      footer={
        undoState.isSafe ? (
          <>
            <Button variant="secondary" onClick={onCancel}>
              Cancelar
            </Button>
            <Button variant="danger" busy={pending} onClick={onConfirm}>
              {pending ? "Deshaciendo…" : "Sí, deshacer la importación"}
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={onCancel}>
            Entendido
          </Button>
        )
      }
    >
      <div role="group" aria-label="Revisión para deshacer la importación" className="flex flex-col gap-2">
        {undoState.isSafe ? (
          <>
            <p className="text-[15px] font-bold text-textPrimary">Se puede deshacer</p>
            <p className="text-[15px] text-textSecondary">
              Nada de lo importado se modificó ni se usó después. Al confirmar, se quita lo que se agregó y los datos que se reemplazaron
              vuelven a su valor anterior.
            </p>
          </>
        ) : (
          <>
            <p className="text-[15px] text-textSecondary">{undoState.explanation}</p>
            <ul className="mt-1 flex flex-col gap-1.5 text-[14.5px] text-textSecondary">
              {undoState.blockedRows.map((row, i) => (
                <li key={i}>
                  {capitalize(row.entityLabel)} tiene datos posteriores que dependen de él:
                  <ul className="ml-4 mt-0.5 list-disc">
                    {row.dependencies.map((dep, j) => (
                      <li key={j}>{dep}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Dialog>
  );
}

/**
 * «Ya no necesito deshacerla»: quitar la opción de deshacer es definitivo, así que pide una confirmación (diálogo) con la
 * consecuencia dicha en claro. Lo importado se queda como está; lo único que se pierde es la posibilidad de revertirlo.
 */
export function DiscardUndoControl({ pending, onDiscard }: { pending: boolean; onDiscard: () => void }) {
  const [asking, setAsking] = useState(false);

  return (
    <>
      <Button variant="ghost" disabled={pending} onClick={() => setAsking(true)} className="self-start" aria-haspopup="dialog">
        Ya no necesito poder deshacerla
      </Button>
      {asking && (
        <Dialog
          title="Quitar la opción de deshacer"
          size="sm"
          onClose={() => setAsking(false)}
          busy={pending}
          footer={
            <>
              <Button variant="secondary" onClick={() => setAsking(false)}>
                Cancelar
              </Button>
              <Button
                variant="danger"
                busy={pending}
                onClick={() => {
                  onDiscard();
                  setAsking(false);
                }}
              >
                {pending ? "Quitando…" : "Sí, quitar la opción de deshacer"}
              </Button>
            </>
          }
        >
          <div role="group" aria-label="Confirmar que ya no se podrá deshacer">
            <p className="text-[15px] text-textSecondary">
              Si seguís, <strong className="text-textPrimary">ya no vas a poder deshacer esta importación</strong>. Lo que importaste se queda tal
              cual está.
            </p>
          </div>
        </Dialog>
      )}
    </>
  );
}
