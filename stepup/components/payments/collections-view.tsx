"use client";

import { useId, useMemo, useRef, useState } from "react";
import { BanknotesIcon, CalendarDaysIcon, ClockIcon, ExclamationCircleIcon, MagnifyingGlassIcon, XMarkIcon } from "@heroicons/react/24/outline";
import PrivateLink from "@/components/nav/private-link";
import { Avatar } from "@/components/ui/avatar";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { linkClass } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import { PageHeader, PAGE_WIDTH } from "@/components/ui/page-header";
import { COLLECTIONS_HEADER_CLASS, COLLECTIONS_ROW_CLASS, COLLECTIONS_TABLE_CLASS } from "@/components/payments/collections-layout";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { ChargeActions } from "@/components/payments/charge-actions";
import { PaymentsSectionNav } from "@/components/payments/payments-section-nav";
import { avatarInitials, avatarToneFor } from "@/lib/ui/avatar-tone";
import { CHARGE_TYPE_LABEL } from "@/lib/payments/labels";
import type { CollectionsCenterEntry } from "@/lib/payments/collections-center";
import { formatCivilDate } from "@/lib/format/date-format";
import { formatMoney } from "@/lib/format/number-format";
import { matchesStudentSearch } from "@/lib/students/search";

/** Estado de una obligación: texto + ícono + tono (nunca sólo color). Los textos y el criterio no cambiaron. */
function collectionStatus(entry: CollectionsCenterEntry): { text: string; tone: BadgeTone; icon: typeof ClockIcon } {
  if (entry.urgency === "vence_pronto") return { text: "Vence pronto", tone: "warn", icon: CalendarDaysIcon };
  if (entry.urgency === "vence_hoy") return { text: "Vence hoy", tone: "warn", icon: ClockIcon };
  if (entry.urgency === "mes_vencido") return { text: "Pago vencido", tone: "bad", icon: ExclamationCircleIcon };
  if (entry.urgency === "pendiente_en_termino") return { text: "Pago pendiente", tone: "info", icon: ClockIcon };
  if (entry.isOverdue) return { text: "Pago vencido", tone: "bad", icon: ExclamationCircleIcon };
  return { text: "Pago pendiente", tone: "info", icon: ClockIcon };
}

// Columnas del escritorio (≥ 820 px): alumno · concepto · vence · estado · saldo · acciones. Debajo de 820 px cada fila es una tarjeta.

/**
 * Cobros (presentación). La página resuelve los datos; esta vista sólo muestra lo que ya carga: alumno, concepto, vencimiento,
 * importe original, saldo y estado. «Registrar pago» y «Anular cobro» son los diálogos reales de `ChargeActions`.
 */
export function CollectionsView({ entries }: { entries: CollectionsCenterEntry[] }) {
  const uid = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  // Búsqueda mientras se escribe, sin Enter ni «Aplicar»: el mismo motor que Alumnos (partes del nombre, mayúsculas, tildes y aproximaciones) sobre TODAS las obligaciones ya cargadas,
  // y es una cuenta síncrona sobre ese listado (no hay respuestas tardías que pisen una búsqueda más nueva). Al borrar vuelve la lista completa.
  const query = text.trim();
  const visible = useMemo(() => (query === "" ? entries : entries.filter((entry) => matchesStudentSearch(entry.studentName, query))), [entries, query]);
  const summary =
    query === ""
      ? `${entries.length} obligaci${entries.length === 1 ? "ón" : "ones"} pendiente${entries.length === 1 ? "" : "s"}`
      : `${visible.length} de ${entries.length} obligaci${entries.length === 1 ? "ón" : "ones"} pendiente${entries.length === 1 ? "" : "s"}`;
  return (
    <div className={PAGE_WIDTH.wide}>
      <PageHeader
        title="Cobros"
        subtitle={<>{summary}.</>}
      />
      <PaymentsSectionNav current="collections" />

      {entries.length === 0 ? (
        <div className="mt-6">
          <EmptyState icon={BanknotesIcon} message="No hay cobros pendientes." />
        </div>
      ) : (
        <>
        <form role="search" aria-label="Buscar alumno entre los cobros pendientes" onSubmit={(event) => event.preventDefault()} className="mt-5 max-w-[360px]">
          <Field label="Buscar alumno" htmlFor={`${uid}-q`}>
            <div className="relative">
              <MagnifyingGlassIcon className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-textMuted" aria-hidden />
              <TextInput
                ref={inputRef}
                id={`${uid}-q`}
                type="search"
                value={text}
                onChange={(event) => setText(event.target.value.slice(0, 80))}
                onKeyDown={(event) => {
                  if (event.key === "Escape" && text !== "") {
                    event.preventDefault();
                    setText("");
                  }
                }}
                placeholder="Nombre del alumno…"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                enterKeyHint="search"
                aria-describedby={`${uid}-status`}
                className="block pl-11 pr-11 [&::-webkit-search-cancel-button]:hidden"
              />
              {text !== "" && (
                <button
                  type="button"
                  onClick={() => {
                    setText("");
                    inputRef.current?.focus();
                  }}
                  aria-label="Borrar búsqueda"
                  className="absolute right-0.5 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-md text-textMuted transition-colors hover:text-textPrimary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                >
                  <XMarkIcon className="h-5 w-5" aria-hidden />
                </button>
              )}
            </div>
          </Field>
        </form>
        <p id={`${uid}-status`} role="status" aria-live="polite" className="mt-2 text-[13px] text-textMuted">
          {query === "" ? "Escribí para buscar por nombre." : visible.length === 0 ? "Ningún alumno coincide con la búsqueda." : `${visible.length} obligaci${visible.length === 1 ? "ón" : "ones"} encontrada${visible.length === 1 ? "" : "s"}.`}
        </p>
        {visible.length === 0 ? (
          <div className="mt-3 flex flex-col items-start gap-3">
            <div className="w-full">
              <ErrorState message="Ningún alumno coincide con la búsqueda." />
            </div>
            <button type="button" className={linkClass()} onClick={() => setText("")}>
              Limpiar búsqueda
            </button>
          </div>
        ) : (
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
            {visible.map((entry) => {
              const status = collectionStatus(entry);
              const concept = CHARGE_TYPE_LABEL[entry.chargeType] ?? entry.chargeType;
              const StatusIcon = status.icon;
              return (
                <li
                  key={entry.chargeId}
                  className={COLLECTIONS_ROW_CLASS}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar initial={avatarInitials(entry.studentName)} tone={avatarToneFor(entry.studentId)} size="m" />
                    <PrivateLink
                      href={`/cobros/alumnos/${entry.studentId}?tab=cobros`}
                      data-tf-shared-name data-tf-shared-id={entry.studentId}
                      className="-my-1 inline-flex min-h-11 min-w-0 items-center font-display text-[18px] font-semibold leading-tight tracking-tight text-textPrimary [overflow-wrap:anywhere] hover:underline hover:decoration-borderMid hover:underline-offset-[3px] nav:font-sans nav:text-[14.5px] nav:font-[650] nav:tracking-normal"
                    >
                      {entry.studentName}
                    </PrivateLink>
                  </div>

                  <div className="flex flex-wrap items-baseline gap-x-1.5 text-[14px] text-textSecondary nav:contents">
                    <p className="min-w-0 [overflow-wrap:anywhere] nav:text-[14.5px] nav:text-textPrimary">{concept}</p>
                    <p className="tf-num nav:text-[14.5px] nav:text-textPrimary">
                      <span aria-hidden className="nav:hidden">
                        ·{" "}
                      </span>
                      <span className="nav:sr-only">vence </span>
                      {formatCivilDate(entry.dueDate)}
                    </p>
                  </div>

                  <div>
                    <Badge tone={status.tone} icon={<StatusIcon className="h-3.5 w-3.5" aria-hidden />}>
                      {status.text}
                    </Badge>
                  </div>

                  <div className="min-w-0 nav:text-right">
                    <p className="text-[13px] text-textMuted nav:sr-only">Saldo pendiente</p>
                    <p className="font-display text-[26px] font-semibold leading-none tracking-tight tf-num text-textPrimary [overflow-wrap:anywhere] nav:text-[20px]">{formatMoney(entry.balance)}</p>
                    {entry.paidAmount > 0 && (
                      <p className="mt-1 text-[12.5px] text-textMuted tf-num">
                        de {formatMoney(entry.originalAmount)} · ya pagó {formatMoney(entry.paidAmount)}
                      </p>
                    )}
                  </div>

                  <ChargeActions
                    chargeId={entry.chargeId}
                    studentId={entry.studentId}
                    balance={entry.balance}
                    compact
                    context={{
                      studentName: entry.studentName,
                      concept,
                      dueDate: entry.dueDate,
                      originalAmount: entry.originalAmount,
                    }}
                  />
                </li>
              );
            })}
          </ul>
        </div>
        )}
        </>
      )}
    </div>
  );
}

/** Error al cargar Cobros: el mensaje de siempre y un reintento (recarga la misma pantalla). */
export function CollectionsErrorView() {
  return (
    <div className={PAGE_WIDTH.wide}>
      <PageHeader title="Cobros" />
      <PaymentsSectionNav current="collections" />
      <div className="mt-6 flex flex-col items-start gap-2">
        <div className="w-full">
          <ErrorState message="No pudimos cargar Cobros." />
        </div>
        <PrivateLink href="/cobros" className={linkClass()}>
          Reintentar
        </PrivateLink>
      </div>
    </div>
  );
}
