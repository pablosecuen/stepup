"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { BanknotesIcon, CheckCircleIcon, ExclamationCircleIcon, MagnifyingGlassIcon, XMarkIcon } from "@heroicons/react/24/outline";
import PrivateLink from "@/components/nav/private-link";
import { Avatar } from "@/components/ui/avatar";
import { linkClass } from "@/components/ui/button";
import { Field, SelectInput, TextInput } from "@/components/ui/field";
import { PageHeader, PAGE_WIDTH } from "@/components/ui/page-header";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { PaymentsSectionNav } from "@/components/payments/payments-section-nav";
import { PerStudentMenu, type PerStudentMenuItem } from "@/components/payments/per-student-menu";
import {
  PER_STUDENT_COLGROUP,
  PER_STUDENT_GROUP_CLASS,
  PER_STUDENT_HEAD_ROW_CLASS,
  PER_STUDENT_TABLE_CLASS,
  PER_STUDENT_TABLE_WRAP_CLASS,
  PER_STUDENT_TD_CLASS,
  PER_STUDENT_TH_CLASS,
  PER_STUDENT_TOOLBAR_CLASS,
} from "@/components/payments/per-student-layout";
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
  conceptShortLabel,
  queryPerStudentRows,
  ratePeriodShort,
  type PerStudentConcept,
  type PerStudentQuery,
  type PerStudentRow,
} from "@/lib/payments/per-student-overview";

function detailHref(studentId: string): string {
  return `/cobros/alumnos/${studentId}?tab=cobros`;
}
/** El plan se edita donde ya se edita: la tarjeta «Plan de cobro» de la pestaña Cobros de la ficha (no hay otro mecanismo). */
function editPlanHref(studentId: string): string {
  return `${detailHref(studentId)}#plan-${studentId}`;
}

/**
 * «Cobro»: la TARIFA del concepto con su unidad («$ 90.000 / mes»), nunca el saldo. Con obligaciones exigibles saldadas lleva una tilde verde; con deuda exigible, el importe en rojo y un
 * ícono de alerta; sin obligaciones exigibles (sin cobros generados o sólo futuros), neutro. Cada estado también se dice con texto accesible, no sólo con color.
 */
function AmountCell({ concept }: { concept: PerStudentConcept }) {
  const due = concept.obligation === "due";
  const settled = concept.obligation === "settled";
  return (
    <td className={`${PER_STUDENT_TD_CLASS} text-right`}>
      <span className="inline-flex flex-wrap items-center justify-end gap-x-1 text-[13px] leading-tight nav:text-[14px]">
        {settled && <CheckCircleIcon className="h-4 w-4 shrink-0 text-statusVerde" aria-hidden />}
        {due && <ExclamationCircleIcon className="h-4 w-4 shrink-0 text-statusRojo" aria-hidden />}
        {concept.rate ? (
          <>
            <span className={`tf-num whitespace-nowrap font-semibold ${due ? "text-statusRojo" : "text-textPrimary"}`}>{formatMoney(concept.rate.amount)}</span>
            <span className="whitespace-nowrap text-textMuted">{ratePeriodShort(concept.rate)}</span>
          </>
        ) : (
          <span className="text-textMuted">{concept.planKey === "complimentary" ? "Sin cargo" : "—"}</span>
        )}
        {settled && <span className="sr-only">Obligaciones exigibles al día</span>}
        {due && <span className="sr-only">Con deuda exigible</span>}
      </span>
    </td>
  );
}

/** «Fecha de pago»: sólo la fecha del último pago realmente asignado a ESE concepto (sin su importe); «—» si no hay. */
function DateCell({ concept }: { concept: PerStudentConcept }) {
  return (
    <td className={`${PER_STUDENT_TD_CLASS} whitespace-nowrap text-[13px] nav:text-[14px]`}>
      {concept.lastPayment ? (
        <span className="tf-num text-textPrimary">{formatDateValue(concept.lastPayment.paidAt)}</span>
      ) : (
        <>
          <span aria-hidden className="text-textMuted">
            —
          </span>
          <span className="sr-only">Sin pagos registrados</span>
        </>
      )}
    </td>
  );
}

function menuItemsFor(row: PerStudentRow, concept: PerStudentConcept, first: boolean): PerStudentMenuItem[] {
  const items: PerStudentMenuItem[] = [];
  if (first) items.push({ key: "detail", label: "Ver detalle", href: detailHref(row.studentId) });
  if (concept.kind === "plan") items.push({ key: "plan", label: "Editar plan", href: editPlanHref(row.studentId) });
  if (concept.kind === "training") items.push({ key: "training", label: "Editar cuota", href: "/calendario/series" });
  return items;
}

function StudentGroup({ row }: { row: PerStudentRow }) {
  const multiple = row.concepts.length > 1;
  const trainingCount = row.concepts.filter((concept) => concept.kind === "training").length;
  return (
    <tbody className={PER_STUDENT_GROUP_CLASS} data-student-row={row.studentId}>
      {row.concepts.map((concept, index) => {
        const first = index === 0;
        const tag = multiple ? conceptShortLabel(concept, trainingCount) : null;
        const items = menuItemsFor(row, concept, first);
        return (
          <tr key={concept.key}>
            <th scope="row" className={`${PER_STUDENT_TD_CLASS} text-left font-normal`}>
              {first ? (
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="hidden nav:inline-flex">
                    <Avatar initial={avatarInitials(row.name)} tone={avatarToneFor(row.studentId)} size="s" />
                  </span>
                  <div className="min-w-0">
                    <PrivateLink
                      href={detailHref(row.studentId)}
                      data-per-student-link={row.studentId}
                      className="flex min-h-11 items-center text-[13.5px] font-[650] leading-tight text-textPrimary [overflow-wrap:anywhere] hover:underline hover:decoration-borderMid hover:underline-offset-[3px] nav:text-[14.5px]"
                    >
                      <span className="line-clamp-2">{row.name}</span>
                    </PrivateLink>
                    {tag && <p className="-mt-1.5 pb-1 text-[12px] leading-tight text-textMuted [overflow-wrap:anywhere]">{tag}</p>}
                  </div>
                </div>
              ) : (
                <p className="flex min-h-8 items-center border-l-2 border-borderMid py-1 pl-1.5 text-[11.5px] leading-tight text-textMuted [overflow-wrap:anywhere] nav:ml-[38px] nav:pl-3 nav:text-[12px]">
                  <span className="sr-only">{row.name}: </span>
                  {tag}
                </p>
              )}
            </th>
            <DateCell concept={concept} />
            <AmountCell concept={concept} />
            <td className="px-0 py-0 align-middle">{items.length > 0 && <PerStudentMenu studentId={row.studentId} label={tag ? `${row.name}, ${tag}` : row.name} items={items} />}</td>
          </tr>
        );
      })}
    </tbody>
  );
}

/**
 * Cobros › Por alumno: todos los alumnos activos en UNA tabla desplazable de tres columnas (nombre · fecha de pago · cobro). Es sólo de consulta (nunca crea cobros ni pagos).
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
  const summary = filtering ? `${visible.length} de ${rows.length} ${rows.length === 1 ? "alumno activo" : "alumnos activos"}` : `${rows.length} ${rows.length === 1 ? "alumno activo" : "alumnos activos"}`;

  return (
    <div className={PAGE_WIDTH.wide}>
      <PageHeader title="Cobros" />
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
            <div className="grid grid-cols-2 gap-2.5 nav:flex nav:items-end">
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
          <p id={`${uid}-status`} role="status" aria-live="polite" className="mt-2 text-[13px] text-textMuted">
            {summary}.
          </p>

          {visible.length === 0 ? (
            <div className="mt-3 flex flex-col items-start gap-3">
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
            <div className={PER_STUDENT_TABLE_WRAP_CLASS}>
              <table className={PER_STUDENT_TABLE_CLASS} onClickCapture={rememberPosition} onAuxClick={rememberPosition}>
                <caption className="sr-only">Tarifa vigente y fecha del último pago de cada alumno activo</caption>
                <colgroup>
                  {PER_STUDENT_COLGROUP.map((width, index) => (
                    <col key={index} className={width} />
                  ))}
                </colgroup>
                <thead>
                  <tr className={PER_STUDENT_HEAD_ROW_CLASS}>
                    <th scope="col" className={`${PER_STUDENT_TH_CLASS} text-left`}>
                      Nombre
                    </th>
                    <th scope="col" className={`${PER_STUDENT_TH_CLASS} text-left`}>
                      Fecha de pago
                    </th>
                    <th scope="col" className={`${PER_STUDENT_TH_CLASS} text-right`}>
                      Cobro
                    </th>
                    <th scope="col" className="p-0">
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                {visible.map((row) => (
                  <StudentGroup key={row.studentId} row={row} />
                ))}
              </table>
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
