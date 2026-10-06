"use client";

import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { CheckCircleIcon, CheckIcon, ExclamationTriangleIcon, InformationCircleIcon } from "@heroicons/react/24/outline";
import type { UndoBlockedPreview } from "@/lib/backup/undo-blocked-mapping";
import { IMPORT_GLOSSARY } from "@/lib/backup/import-copy";
import { BUTTON_DANGER, BUTTON_DANGER_OUTLINE, BUTTON_SECONDARY } from "@/components/account/settings-ui";

// Piezas compartidas del asistente de importación y del historial: avisos con ícono (el tono nunca es sólo color), el error con
// su código de soporte, el indicador de pasos, el vocabulario y el flujo de «deshacer» (revisar → confirmar) que usan los dos.

type NoticeTone = "info" | "warning" | "danger" | "success";

const NOTICE_STYLE: Record<NoticeTone, { box: string; Icon: typeof InformationCircleIcon; label: string; iconClass: string }> = {
  info: { box: "border-border bg-background", Icon: InformationCircleIcon, label: "Información", iconClass: "text-brandBlue" },
  warning: { box: "border-statusAmarillo/40 bg-statusAmarillo/5", Icon: ExclamationTriangleIcon, label: "Atención", iconClass: "text-statusAmarillo" },
  danger: { box: "border-statusRojo/30 bg-statusRojo/5", Icon: ExclamationTriangleIcon, label: "Importante", iconClass: "text-statusRojo" },
  success: { box: "border-statusVerde/30 bg-statusVerde/5", Icon: CheckCircleIcon, label: "Listo", iconClass: "text-statusVerde" },
};

/** Aviso con ícono y una palabra («Atención», «Importante»…) que lee también un lector de pantalla. */
export function Notice({ tone = "info", title, children }: { tone?: NoticeTone; title?: string; children: ReactNode }) {
  const { box, Icon, label, iconClass } = NOTICE_STYLE[tone];
  return (
    <div className={`flex gap-3 rounded-md border p-3.5 text-sm text-textSecondary ${box}`}>
      <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${iconClass}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-textPrimary">
          <span className="sr-only">{label}: </span>
          {title ?? label}
        </p>
        <div className="mt-1 flex flex-col gap-1.5">{children}</div>
      </div>
    </div>
  );
}

/** Error del asistente: la frase útil y, aparte, el código corto que soporte necesita (nunca datos ni ids). */
export function ImportErrorBox({ message, code, boxRef }: { message: string; code?: string | null; boxRef?: Ref<HTMLDivElement> }) {
  return (
    <div
      ref={boxRef}
      role="alert"
      tabIndex={-1}
      className="rounded-md border border-statusRojo/30 bg-statusRojo/5 px-3.5 py-3 text-sm text-statusRojo focus:outline-none focus-visible:ring-2 focus-visible:ring-statusRojo"
    >
      <p>{message}</p>
      {code && (
        <p className="mt-1.5 text-xs text-textSecondary">
          Código para soporte: <span className="select-all font-mono font-semibold text-textPrimary">{code}</span>
        </p>
      )}
    </div>
  );
}

const STEPS = ["Analizar", "Revisar y decidir", "Resultado"] as const;

/** «Paso 2 de 3»: la lista numerada marca el paso actual con `aria-current` y un tilde en los pasos ya hechos. */
export function StepIndicator({ current }: { current: 1 | 2 | 3 }) {
  return (
    <nav aria-label="Pasos de la importación">
      <ol className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
        {STEPS.map((label, index) => {
          const number = index + 1;
          const done = number < current;
          const active = number === current;
          return (
            <li key={label} aria-current={active ? "step" : undefined} className={`flex items-center gap-2 ${active ? "font-semibold text-textPrimary" : "text-textMuted"}`}>
              <span
                aria-hidden
                className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs font-semibold ${
                  active ? "border-brandBlue bg-brandBlue text-white" : done ? "border-statusVerde text-statusVerde" : "border-borderStrong"
                }`}
              >
                {done ? <CheckIcon className="h-3.5 w-3.5" /> : number}
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
          <dt className="inline font-semibold text-textPrimary">{entry.term}:</dt> <dd className="inline text-textSecondary">{entry.meaning}</dd>
        </div>
      ))}
    </dl>
  );
}

function capitalize(text: string): string {
  return text.charAt(0).toLocaleUpperCase("es") + text.slice(1);
}

/**
 * Resultado de «revisar si se puede deshacer»: si es seguro, pide la confirmación con lo que va a pasar; si no, explica por qué
 * está bloqueado (y que no se toca nada). El foco entra al panel al abrirse.
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
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="group"
      aria-label="Revisión para deshacer la importación"
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
      className="rounded-md border border-border bg-background p-3.5 focus:outline-none"
    >
      {undoState.isSafe ? (
        <>
          <p className="text-sm font-semibold text-textPrimary">Se puede deshacer</p>
          <p className="mt-1 text-sm text-textSecondary">
            Nada de lo importado se modificó ni se usó después. Al confirmar, se quita lo que se agregó y los datos que se reemplazaron
            vuelven a su valor anterior.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={pending} aria-busy={pending} onClick={onConfirm} className={BUTTON_DANGER}>
              {pending ? "Deshaciendo…" : "Sí, deshacer la importación"}
            </button>
            <button type="button" onClick={onCancel} className={BUTTON_SECONDARY}>
              Cancelar
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm font-semibold text-statusRojo">No se puede deshacer ahora</p>
          <p className="mt-1 text-sm text-textSecondary">{undoState.explanation}</p>
          <ul className="mt-2 flex flex-col gap-1.5 text-sm text-textSecondary">
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
          <div className="mt-3">
            <button type="button" onClick={onCancel} className={BUTTON_SECONDARY}>
              Entendido
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * «Ya no necesito deshacerla»: quitar la opción de deshacer es definitivo, así que pide una confirmación con la consecuencia
 * dicha en claro. Lo importado se queda como está; lo único que se pierde es la posibilidad de revertirlo.
 */
export function DiscardUndoControl({ pending, onDiscard }: { pending: boolean; onDiscard: () => void }) {
  const [asking, setAsking] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef(false);

  useEffect(() => {
    if (asking) panelRef.current?.focus();
    else if (restoreFocus.current) {
      restoreFocus.current = false;
      triggerRef.current?.focus();
    }
  }, [asking]);

  function cancel() {
    restoreFocus.current = true;
    setAsking(false);
  }

  if (!asking) {
    return (
      <button ref={triggerRef} type="button" disabled={pending} onClick={() => setAsking(true)} className={`self-start ${BUTTON_SECONDARY}`}>
        Ya no necesito poder deshacerla
      </button>
    );
  }

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      role="group"
      aria-label="Confirmar que ya no se podrá deshacer"
      onKeyDown={(event) => {
        if (event.key === "Escape") cancel();
      }}
      className="rounded-md border border-statusRojo/30 bg-statusRojo/5 p-3.5 focus:outline-none"
    >
      <p className="text-sm text-textSecondary">
        Si seguís, <strong className="text-textPrimary">ya no vas a poder deshacer esta importación</strong>. Lo que importaste se queda tal
        cual está.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          aria-busy={pending}
          onClick={() => {
            restoreFocus.current = true;
            onDiscard();
            setAsking(false);
          }}
          className={BUTTON_DANGER_OUTLINE}
        >
          {pending ? "Quitando…" : "Sí, quitar la opción de deshacer"}
        </button>
        <button type="button" onClick={cancel} className={BUTTON_SECONDARY}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
