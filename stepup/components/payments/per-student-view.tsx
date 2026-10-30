"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BanknotesIcon, MagnifyingGlassIcon, XMarkIcon } from "@heroicons/react/24/outline";
import PrivateLink from "@/components/nav/private-link";
import { Avatar } from "@/components/ui/avatar";
import { linkClass } from "@/components/ui/button";
import { Field, SelectInput, TextInput } from "@/components/ui/field";
import { PageHeader, PAGE_WIDTH } from "@/components/ui/page-header";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { PaymentsSectionNav } from "@/components/payments/payments-section-nav";
import { PER_STUDENT_GRID_CLASS, PER_STUDENT_HEADER_CLASS, PER_STUDENT_ROW_CLASS, PER_STUDENT_SUBROWS_CLASS, PER_STUDENT_TABLE_CLASS, PER_STUDENT_TOOLBAR_CLASS } from "@/components/payments/per-student-layout";
import { clearPerStudentMemory, readPerStudentMemory, writePerStudentMemory } from "@/components/payments/per-student-memory";
import { formatDateValue } from "@/lib/format/date-format";
import { formatMoney } from "@/lib/format/number-format";
import { avatarInitials, avatarToneFor } from "@/lib/ui/avatar-tone";
import {
  PER_STUDENT_PLAN_FILTERS,
  PER_STUDENT_SORT_LABEL,
  PER_STUDENT_SORTS,
  PLAN_FILTER_LABEL,
  buildPerStudentHref,
  queryPerStudentRows,
  ratePeriodLabel,
  type ConceptPayment,
  type PerStudentConcept,
  type PerStudentQuery,
  type PerStudentRow,
  type UnassignedPayment,
} from "@/lib/payments/per-student-overview";

const SMALL_LABEL = "text-[12.5px] leading-tight text-textMuted nav:sr-only";
const ACTION_CLASS =
  "inline-flex min-h-11 items-center justify-center rounded-pill border-[1.5px] border-borderStrong bg-surface px-3.5 text-[14px] font-semibold text-textPrimary transition-colors hover:border-ink hover:bg-paperDeep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink";

function detailHref(studentId: string): string {
  return `/cobros/alumnos/${studentId}?tab=cobros`;
}
/** El plan se edita donde ya se edita: la tarjeta «Plan de cobro» de la pestaña Cobros de la ficha (no hay otro mecanismo). */
function editPlanHref(studentId: string): string {
  return `${detailHref(studentId)}#plan-${studentId}`;
}

function RateCell({ concept }: { concept: PerStudentConcept }) {
  return (
    <div className="min-w-0">
      <p className={SMALL_LABEL}>Cobro</p>
      <p className="text-[14px] font-semibold text-textPrimary [overflow-wrap:anywhere] nav:text-[14.5px]">{concept.label}</p>
      {concept.rate ? (
        <p className="tf-num text-[15px] text-textPrimary nav:text-[14.5px]">
          <span className="font-bold">{formatMoney(concept.rate.amount)}</span> {ratePeriodLabel(concept.rate)}
        </p>
      ) : (
        <p className="text-[14px] text-textSecondary">{concept.kind === "plan" ? "No genera cobros" : concept.kind === "training" ? "Sin cuota vinculada" : "Sin tarifa vigente"}</p>
      )}
      {concept.upcomingRate && (
        <p className="tf-num text-[12.5px] text-textMuted">
          Desde {concept.upcomingRate.effectiveFrom.slice(5, 7)}/{concept.upcomingRate.effectiveFrom.slice(0, 4)}: {formatMoney(concept.upcomingRate.amount)} {concept.rate ? ratePeriodLabel({ ...concept.rate, amount: 0 }) : ""}
        </p>
      )}
    </div>
  );
}

function PaymentDetail({ payment, unassigned = false }: { payment: ConceptPayment | UnassignedPayment; unassigned?: boolean }) {
  const total = "paymentAmount" in payment ? payment.paymentAmount : payment.amount;
  return (
    <>
      <p className="tf-num text-[15px] text-textPrimary nav:text-[14.5px]">
        <span className="font-bold">{formatDateValue(payment.paidAt)}</span> · {formatMoney(payment.amount)}
      </p>
      {payment.amount !== total && <p className="tf-num text-[12.5px] text-textMuted">Parte de un pago de {formatMoney(total)}</p>}
      {unassigned && <p className="text-[12.5px] text-textMuted">Pago sin cobro asignado: no se puede saber a qué concepto corresponde.</p>}
      {payment.declared && <p className="text-[12.5px] text-textMuted">Situación inicial declarada, no un cobro registrado en una fecha.</p>}
    </>
  );
}

function PaymentCell({ children }: { children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className={SMALL_LABEL}>Fecha de pago</p>
      {children}
    </div>
  );
}

function BalanceCell({ amount, openCharges }: { amount: number; openCharges: number }) {
  return (
    <div className="min-w-0">
      {amount > 0 ? (
        <>
          <p className="tf-num text-[13px] text-textSecondary nav:text-[13.5px]">
            Saldo pendiente: <span className="font-semibold">{formatMoney(amount)}</span>
          </p>
          <p className="text-[12px] text-textMuted">
            {openCharges} {openCharges === 1 ? "cobro abierto" : "cobros abiertos"}
          </p>
        </>
      ) : (
        <p className="text-[13px] text-textMuted nav:text-[13.5px]">Sin saldo pendiente</p>
      )}
    </div>
  );
}

/** Para un alumno con un solo concepto: su último pago asignado o, si hay uno más reciente sin asignar, ése (indicándolo). */
function singleConceptPayment(row: PerStudentRow): { payment: ConceptPayment | UnassignedPayment; unassigned: boolean } | null {
  const assigned = row.concepts[0]?.lastPayment ?? null;
  const unassigned = row.unassignedPayments[0] ?? null;
  if (assigned && (!unassigned || assigned.paidAt >= unassigned.paidAt)) return { payment: assigned, unassigned: false };
  if (unassigned) return { payment: unassigned, unassigned: true };
  return null;
}

function StudentRowItem({ row }: { row: PerStudentRow }) {
  const single = row.concepts.length === 1;
  const concept = row.concepts[0];
  const shown = single ? singleConceptPayment(row) : null;
  return (
    <li className={PER_STUDENT_ROW_CLASS} data-student-row={row.studentId}>
      <div className={PER_STUDENT_GRID_CLASS}>
        <div className="flex min-w-0 items-center gap-3">
          <Avatar initial={avatarInitials(row.name)} tone={avatarToneFor(row.studentId)} size="m" />
          <PrivateLink
            href={detailHref(row.studentId)}
            data-per-student-link={row.studentId}
            className="-my-1 inline-flex min-h-11 min-w-0 items-center font-display text-[18px] font-semibold leading-tight tracking-tight text-textPrimary [overflow-wrap:anywhere] hover:underline hover:decoration-borderMid hover:underline-offset-[3px] nav:font-sans nav:text-[14.5px] nav:font-[650] nav:tracking-normal"
          >
            {row.name}
          </PrivateLink>
        </div>
        {single ? (
          <>
            <RateCell concept={concept} />
            <PaymentCell>{shown ? <PaymentDetail payment={shown.payment} unassigned={shown.unassigned} /> : <p className="text-[14px] text-textSecondary nav:text-[14.5px]">Sin pagos registrados</p>}</PaymentCell>
          </>
        ) : (
          <>
            <div className="min-w-0">
              <p className={SMALL_LABEL}>Cobro</p>
              <p className="text-[14px] font-semibold text-textPrimary nav:text-[14.5px]">{row.concepts.length} conceptos de cobro</p>
              <p className="text-[12.5px] text-textMuted">Cada uno con su tarifa y su pago, abajo.</p>
            </div>
            <div aria-hidden className="max-nav:hidden" />
          </>
        )}
        <BalanceCell amount={row.pendingBalance} openCharges={row.concepts.reduce((sum, item) => sum + item.openCharges, 0)} />
        <div className="flex flex-wrap items-center gap-2 nav:justify-end">
          <PrivateLink href={detailHref(row.studentId)} data-per-student-link={row.studentId} className={`min-h-11 ${ACTION_CLASS}`}>
            Ver detalle<span className="sr-only"> de {row.name}</span>
          </PrivateLink>
          {single && (
            <PrivateLink href={editPlanHref(row.studentId)} data-per-student-link={row.studentId} className={`min-h-11 ${ACTION_CLASS}`}>
              Editar plan<span className="sr-only"> de {row.name}</span>
            </PrivateLink>
          )}
        </div>
      </div>
      {!single && (
        <ul aria-label={`Conceptos de ${row.name}`} className={PER_STUDENT_SUBROWS_CLASS}>
          {row.concepts.map((item) => (
            <li key={item.key} className={PER_STUDENT_GRID_CLASS}>
              <div className="min-w-0 border-l-2 border-borderMid pl-3 nav:pl-4">
                <p className="text-[14px] font-semibold text-textPrimary [overflow-wrap:anywhere] nav:text-[14.5px]">{item.kind === "training" ? "Entrenamiento" : item.label}</p>
                {item.seriesName && <p className="text-[12.5px] text-textMuted [overflow-wrap:anywhere]">Serie: {item.seriesName}</p>}
              </div>
              <RateCell concept={item} />
              <PaymentCell>{item.lastPayment ? <PaymentDetail payment={item.lastPayment} /> : <p className="text-[14px] text-textSecondary nav:text-[14.5px]">Sin pagos registrados</p>}</PaymentCell>
              <BalanceCell amount={item.pendingBalance} openCharges={item.openCharges} />
              <div className="flex flex-wrap items-center gap-2 nav:justify-end">
                {item.kind === "plan" && (
                  <PrivateLink href={editPlanHref(row.studentId)} data-per-student-link={row.studentId} className={`min-h-11 ${ACTION_CLASS}`}>
                    Editar plan<span className="sr-only"> de {row.name}</span>
                  </PrivateLink>
                )}
                {item.kind === "training" && (
                  <PrivateLink href="/calendario/series" data-per-student-link={row.studentId} className={`min-h-11 ${ACTION_CLASS}`}>
                    Editar cuota<span className="sr-only"> de entrenamiento de {row.name}</span>
                  </PrivateLink>
                )}
              </div>
            </li>
          ))}
          {row.unassignedPayments.length > 0 && (
            <li className={PER_STUDENT_GRID_CLASS}>
              <div className="min-w-0 border-l-2 border-borderMid pl-3 nav:pl-4">
                <p className="text-[14px] font-semibold text-textPrimary nav:text-[14.5px]">Pago sin concepto identificado</p>
              </div>
              <div aria-hidden className="max-nav:hidden" />
              <PaymentCell>
                <PaymentDetail payment={row.unassignedPayments[0]} unassigned />
                {row.unassignedPayments.length > 1 && <p className="text-[12.5px] text-textMuted">y {row.unassignedPayments.length - 1} {row.unassignedPayments.length === 2 ? "pago más" : "pagos más"} sin asignar</p>}
              </PaymentCell>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

/**
 * Cobros › Por alumno: todos los alumnos activos en UNA vista desplazable, con su tarifa vigente, su último pago y su saldo pendiente. Es sólo de consulta (nunca crea cobros ni pagos).
 * La búsqueda se aplica mientras se escribe sobre la lista completa; la búsqueda, el plan y el orden viven en la dirección (sin recargar) y, junto con la posición, se recuerdan al abrir un detalle.
 */
export function PerStudentView({ rows, initialQuery }: { rows: PerStudentRow[]; initialQuery: PerStudentQuery }) {
  const uid = useId();
  const [text, setText] = useState(initialQuery.text);
  const [plan, setPlan] = useState(initialQuery.plan);
  const [sort, setSort] = useState(initialQuery.sort);
  const inputRef = useRef<HTMLInputElement>(null);
  const firstRender = useRef(true);
  const query = useMemo<PerStudentQuery>(() => ({ text, plan, sort }), [text, plan, sort]);
  const visible = useMemo(() => queryPerStudentRows(rows, query), [rows, query]);

  // La dirección refleja la búsqueda, el plan y el orden (sin navegar: no hay recarga ni esqueleto).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    window.history.replaceState(window.history.state, "", buildPerStudentHref(query));
  }, [query]);

  // Al volver de un detalle: misma lista y mismo punto de desplazamiento.
  useLayoutEffect(() => {
    const memory = readPerStudentMemory();
    if (!memory) return;
    if (memory.href === buildPerStudentHref(initialQuery)) window.scrollTo(0, memory.y);
    clearPerStudentMemory();
    // sólo al montar
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function rememberPosition(event: { target: EventTarget }) {
    const link = event.target instanceof Element ? event.target.closest<HTMLElement>("a[data-per-student-link]") : null;
    if (!link) return;
    writePerStudentMemory({ href: buildPerStudentHref(query), y: window.scrollY, studentId: link.getAttribute("data-per-student-link") });
  }

  const filtering = text.trim() !== "" || plan !== "todos";
  const periodHint = plan === "todos" && (sort === "tarifa_asc" || sort === "tarifa_desc");
  const summary = filtering ? `${visible.length} de ${rows.length} ${rows.length === 1 ? "alumno activo" : "alumnos activos"}` : `${rows.length} ${rows.length === 1 ? "alumno activo" : "alumnos activos"}`;

  return (
    <div className={PAGE_WIDTH.wide}>
      <PageHeader title="Cobros" subtitle="Tarifa vigente, último pago y saldo de cada alumno activo." />
      <PaymentsSectionNav current="students" />

      {rows.length === 0 ? (
        <div className="mt-6">
          <EmptyState icon={BanknotesIcon} message="Todavía no hay alumnos activos." />
        </div>
      ) : (
        <>
          <form role="search" aria-label="Buscar y filtrar alumnos por cobro" onSubmit={(event) => event.preventDefault()} className={PER_STUDENT_TOOLBAR_CLASS}>
            <div className="min-w-0 nav:w-[320px]">
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
            </div>
            <div className="grid grid-cols-2 gap-3 nav:flex nav:items-end">
              <div className="min-w-0 nav:w-[190px]">
                <Field label="Plan" htmlFor={`${uid}-plan`}>
                  <SelectInput id={`${uid}-plan`} value={plan} onChange={(event) => setPlan(PER_STUDENT_PLAN_FILTERS.find((candidate) => candidate === event.target.value) ?? "todos")}>
                    {PER_STUDENT_PLAN_FILTERS.map((option) => (
                      <option key={option} value={option}>
                        {PLAN_FILTER_LABEL[option]}
                      </option>
                    ))}
                  </SelectInput>
                </Field>
              </div>
              <div className="min-w-0 nav:w-[250px]">
                <Field label="Ordenar por" htmlFor={`${uid}-sort`}>
                  <SelectInput id={`${uid}-sort`} value={sort} onChange={(event) => setSort(PER_STUDENT_SORTS.find((candidate) => candidate === event.target.value) ?? "nombre")}>
                    {PER_STUDENT_SORTS.map((option) => (
                      <option key={option} value={option}>
                        {PER_STUDENT_SORT_LABEL[option]}
                      </option>
                    ))}
                  </SelectInput>
                </Field>
              </div>
            </div>
          </form>
          <p id={`${uid}-status`} role="status" aria-live="polite" className="mt-3 text-[13.5px] text-textMuted">
            {summary}.{periodHint && " Las tarifas se comparan dentro de la misma periodicidad: clase, semana, quincena, mes y paquete por separado."}
          </p>

          {visible.length === 0 ? (
            <div className="mt-4 flex flex-col items-start gap-3">
              <div className="w-full">
                <ErrorState message="Ningún alumno coincide con la búsqueda o el plan elegido." />
              </div>
              <button
                type="button"
                className={linkClass()}
                onClick={() => {
                  setText("");
                  setPlan("todos");
                }}
              >
                Limpiar búsqueda y filtro
              </button>
            </div>
          ) : (
            <div className={PER_STUDENT_TABLE_CLASS}>
              <div aria-hidden className={PER_STUDENT_HEADER_CLASS}>
                <span>Nombre</span>
                <span>Cobro</span>
                <span>Fecha de pago</span>
                <span>Saldo pendiente</span>
                <span className="w-[200px]" />
              </div>
              <ul className="flex flex-col gap-3 nav:gap-0" onClickCapture={rememberPosition} onAuxClick={rememberPosition}>
                {visible.map((row) => (
                  <StudentRowItem key={row.studentId} row={row} />
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Error al cargar Cobros › Por alumno: el mensaje de siempre y un reintento (recarga la misma pantalla). */
export function PerStudentErrorView() {
  return (
    <div className={PAGE_WIDTH.wide}>
      <PageHeader title="Cobros" />
      <PaymentsSectionNav current="students" />
      <div className="mt-6 flex flex-col items-start gap-2">
        <div className="w-full">
          <ErrorState message="No pudimos cargar los cobros por alumno." />
        </div>
        <PrivateLink href="/cobros/por-alumno" className={linkClass()}>
          Reintentar
        </PrivateLink>
      </div>
    </div>
  );
}
