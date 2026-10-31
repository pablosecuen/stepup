"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BanknotesIcon, CheckCircleIcon, ChevronDownIcon, ExclamationCircleIcon, MagnifyingGlassIcon, XMarkIcon } from "@heroicons/react/24/outline";
import PrivateLink from "@/components/nav/private-link";
import { Avatar } from "@/components/ui/avatar";
import { linkClass } from "@/components/ui/button";
import { Field, SelectInput, TextInput } from "@/components/ui/field";
import { PageHeader, PAGE_WIDTH } from "@/components/ui/page-header";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { PaymentsSectionNav } from "@/components/payments/payments-section-nav";
import { PerStudentMenu, type PerStudentMenuItem } from "@/components/payments/per-student-menu";
import {
  PER_STUDENT_AMOUNT_GRID_CLASS,
  PER_STUDENT_COLGROUP,
  PER_STUDENT_DOLLAR_CLASS,
  PER_STUDENT_FIGURE_CLASS,
  PER_STUDENT_GROUP_CLASS,
  PER_STUDENT_HEAD_ROW_CLASS,
  PER_STUDENT_INDICATOR_CLASS,
  PER_STUDENT_NONE_CLASS,
  PER_STUDENT_ROW_CLASS,
  PER_STUDENT_TABLE_CLASS,
  PER_STUDENT_TABLE_WRAP_CLASS,
  PER_STUDENT_TD_CLASS,
  PER_STUDENT_TH_CLASS,
  PER_STUDENT_TOGGLE_SLOT_CLASS,
  PER_STUDENT_TOOLBAR_CLASS,
  PER_STUDENT_UNIT_CLASS,
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
  cobroDisplayForConcept,
  cobroDisplayForRow,
  conceptShortLabel,
  queryPerStudentRows,
  ratePeriodShort,
  type CobroDisplay,
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

/** Las cifras sin el signo: el signo $ tiene su propia posición en la grilla. */
function moneyDigits(amount: number): string {
  const text = formatMoney(amount);
  return text.slice(text.indexOf("$") + 1).trim();
}

/**
 * «Cobro» (la misma regla para el alumno y para cada concepto, ver `cobroDisplayForRow`): con deuda, el TOTAL de los saldos reales pendientes en rojo con ícono de alerta; sin deuda, la tarifa
 * con su unidad, con tilde verde sólo si lo exigible está pagado y neutra si no hay información suficiente. Indicador, signo $, cifra, unidad y desplegable son columnas propias.
 */
function AmountCell({ display, toggle }: { display: CobroDisplay; toggle?: ReactNode }) {
  const debt = display.kind === "debt";
  const settled = display.kind !== "debt" && display.status === "settled";
  const tone = debt ? "text-statusRojo" : "text-textPrimary";
  return (
    <td className={PER_STUDENT_TD_CLASS}>
      <div className={PER_STUDENT_AMOUNT_GRID_CLASS}>
        <span className={PER_STUDENT_INDICATOR_CLASS}>
          {settled && <CheckCircleIcon className="h-4 w-4 text-statusVerde" aria-hidden />}
          {debt && <ExclamationCircleIcon className="h-4 w-4 text-statusRojo" aria-hidden />}
        </span>
        {display.kind === "none" ? (
          <span className={PER_STUDENT_NONE_CLASS}>{display.label}</span>
        ) : (
          <>
            <span className={`${PER_STUDENT_DOLLAR_CLASS} font-semibold ${tone}`}>$</span>
            <span className={`${PER_STUDENT_FIGURE_CLASS} font-semibold ${tone}`}>{moneyDigits(display.kind === "debt" ? display.amount : display.rate.amount)}</span>
            <span className={PER_STUDENT_UNIT_CLASS}>{display.kind === "debt" ? "deuda" : ratePeriodShort(display.rate)}</span>
          </>
        )}
        <span className={PER_STUDENT_TOGGLE_SLOT_CLASS}>{toggle}</span>
        {settled && <span className="sr-only">Obligaciones exigibles al día</span>}
        {debt && <span className="sr-only">Con deuda: total pendiente</span>}
      </div>
    </td>
  );
}

/** «Fecha de pago»: sólo la fecha (sin importe) —la del último pago real del alumno en su fila, la del pago asignado a ese concepto en cada detalle—; «—» si no hay. */
function DateCell({ paidAt }: { paidAt: string | null }) {
  return (
    <td className={`${PER_STUDENT_TD_CLASS} whitespace-nowrap text-[13px] nav:text-[14px]`}>
      {paidAt ? (
        <span className="tf-num text-textPrimary">{formatDateValue(paidAt)}</span>
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

/** Las opciones de edición de UN concepto: su plan de cobro o la cuota de su entrenamiento (un plan anterior ya no se edita). */
function conceptItems(row: PerStudentRow, concept: PerStudentConcept): PerStudentMenuItem[] {
  if (concept.kind === "plan") return [{ key: "plan", label: "Editar plan", href: editPlanHref(row.studentId) }];
  if (concept.kind === "training") return [{ key: "training", label: "Editar cuota", href: "/calendario/series" }];
  return [];
}

/** Una fila cerrada por alumno, siempre con la misma estructura (nombre · fecha de pago · cobro). El desplegable abre sus conceptos en subfilas con las mismas columnas. */
function StudentGroup({ row, open, onToggle }: { row: PerStudentRow; open: boolean; onToggle: () => void }) {
  const trainingCount = row.concepts.filter((concept) => concept.kind === "training").length;
  const groupId = `conceptos-${row.studentId}`;
  const detail: PerStudentMenuItem = { key: "detail", label: "Ver detalle", href: detailHref(row.studentId) };
  const mainItems: PerStudentMenuItem[] = row.concepts.length === 1 ? [detail, ...conceptItems(row, row.concepts[0])] : [detail];
  return (
    <tbody id={groupId} className={PER_STUDENT_GROUP_CLASS} data-student-row={row.studentId} data-open={open ? "true" : "false"}>
      <tr className={PER_STUDENT_ROW_CLASS}>
        <th scope="row" className={`${PER_STUDENT_TD_CLASS} text-left font-normal`}>
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="hidden nav:inline-flex">
              <Avatar initial={avatarInitials(row.name)} tone={avatarToneFor(row.studentId)} size="s" />
            </span>
            <PrivateLink
              href={detailHref(row.studentId)}
              data-per-student-link={row.studentId}
              className="flex min-h-11 min-w-0 items-center text-[13.5px] font-[650] leading-tight text-textPrimary [overflow-wrap:anywhere] hover:underline hover:decoration-borderMid hover:underline-offset-[3px] nav:text-[14.5px]"
            >
              <span data-tf-shared-name data-tf-shared-id={row.studentId} title={row.name} className="line-clamp-2">
                {row.name}
              </span>
            </PrivateLink>
          </div>
        </th>
        <DateCell paidAt={row.latestPaidAt} />
        <AmountCell
          display={cobroDisplayForRow(row)}
          toggle={
            <button
              type="button"
              aria-expanded={open}
              aria-controls={open ? groupId : undefined}
              aria-label={`${open ? "Ocultar" : "Ver"} los conceptos de ${row.name}`}
              onClick={onToggle}
              className="inline-flex h-11 w-7 items-center justify-center rounded-md text-textSecondary hover:bg-paperDeep hover:text-textPrimary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink nav:w-9"
            >
              <ChevronDownIcon className={`h-4 w-4 shrink-0 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} aria-hidden />
            </button>
          }
        />
        <td className="px-0 py-0 align-middle">{mainItems.length > 0 && <PerStudentMenu studentId={row.studentId} label={row.name} items={mainItems} />}</td>
      </tr>
      {open &&
        row.concepts.map((concept) => {
          const tag = conceptShortLabel(concept, trainingCount);
          const items = conceptItems(row, concept);
          return (
            <tr key={concept.key} className={`${PER_STUDENT_ROW_CLASS} bg-surface2/60`}>
              <th scope="row" className={`${PER_STUDENT_TD_CLASS} text-left font-normal`}>
                <p className="flex min-h-8 items-center border-l-2 border-borderMid py-1 pl-1 text-[11px] leading-tight text-textSecondary [overflow-wrap:anywhere] nav:ml-[38px] nav:pl-3 nav:text-[12.5px]">
                  <span className="sr-only">{row.name}: </span>
                  {tag}
                </p>
              </th>
              <DateCell paidAt={concept.lastPayment?.paidAt ?? null} />
              <AmountCell display={cobroDisplayForConcept(concept)} />
              <td className="px-0 py-0 align-middle">{items.length > 0 && <PerStudentMenu studentId={row.studentId} label={`${row.name}, ${tag}`} items={items} />}</td>
            </tr>
          );
        })}
    </tbody>
  );
}

/**
 * Cobros › Por alumno: todos los alumnos activos en UNA tabla desplazable de tres columnas (nombre · fecha de pago · cobro), una fila cerrada por alumno. Es sólo de consulta (nunca crea
 * cobros ni pagos). La búsqueda se aplica mientras se escribe sobre la lista completa; la búsqueda, el plan y el orden viven en la dirección (sin recargar) y, junto con la posición y los
 * conceptos desplegados, se recuerdan al abrir un detalle.
 */
export function PerStudentView({ rows, initialQuery }: { rows: PerStudentRow[]; initialQuery: PerStudentQuery }) {
  const uid = useId();
  const [text, setText] = useState(initialQuery.text);
  const [plan, setPlan] = useState(initialQuery.plan);
  const [sort, setSort] = useState(initialQuery.sort);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const pendingScrollY = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const appliedHref = useRef(buildPerStudentHref(initialQuery));
  const query = useMemo<PerStudentQuery>(() => ({ text, plan, sort }), [text, plan, sort]);
  const visible = useMemo(() => queryPerStudentRows(rows, query), [rows, query]);

  // La dirección refleja la búsqueda, el plan y el orden (sin navegar: no hay recarga ni esqueleto).
  useEffect(() => {
    const href = buildPerStudentHref(query);
    if (href === appliedHref.current) return;
    appliedHref.current = href;
    window.history.replaceState(window.history.state, "", href);
  }, [query]);

  // Al volver de un detalle: mismos conceptos desplegados y, ya dibujados, el mismo punto de desplazamiento. La memoria sólo existe en el navegador: se aplica tras hidratar.
  // El efecto del desplazamiento va ANTES que el de la restauración: en el montaje corre primero (sin nada pendiente) y sólo actúa en el dibujo que sigue a restaurar los desplegables.
  useLayoutEffect(() => {
    const y = pendingScrollY.current;
    if (y === null) return;
    pendingScrollY.current = null;
    window.scrollTo(0, y);
    // El router también acomoda el desplazamiento de la pantalla recién montada: se reafirma unos instantes, salvo que la persona ya se haya movido.
    let moved = false;
    const stop = () => {
      moved = true;
    };
    window.addEventListener("wheel", stop, { once: true, passive: true });
    window.addEventListener("touchstart", stop, { once: true, passive: true });
    window.addEventListener("keydown", stop, { once: true });
    const timers = [0, 60, 160, 320, 600].map((delay) =>
      window.setTimeout(() => {
        if (!moved && Math.abs(window.scrollY - y) > 2) window.scrollTo(0, y);
      }, delay),
    );
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchstart", stop);
      window.removeEventListener("keydown", stop);
    };
  }, [expanded]);
  useLayoutEffect(() => {
    const memory = readPerStudentMemory();
    if (!memory) return;
    if (memory.href === buildPerStudentHref(initialQuery)) {
      pendingScrollY.current = memory.y;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setExpanded(new Set(memory.expanded));
    }
    clearPerStudentMemory();
    // sólo al montar
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle(studentId: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(studentId)) next.add(studentId);
      return next;
    });
  }

  function rememberPosition(event: { target: EventTarget }) {
    const link = event.target instanceof Element ? event.target.closest<HTMLElement>("a[data-per-student-link]") : null;
    if (!link) return;
    writePerStudentMemory({ href: buildPerStudentHref(query), y: window.scrollY, studentId: link.getAttribute("data-per-student-link"), expanded: [...expanded] });
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
                  <StudentGroup key={row.studentId} row={row} open={expanded.has(row.studentId)} onToggle={() => toggle(row.studentId)} />
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
