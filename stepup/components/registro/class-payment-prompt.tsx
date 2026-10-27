"use client";

import { useId, useRef, useState, useTransition, type ComponentType, type ReactNode, type SVGProps } from "react";
import { ArrowRightCircleIcon, CalendarDaysIcon, ChartPieIcon, CheckCircleIcon, CheckIcon, ChevronRightIcon, ClockIcon } from "@heroicons/react/24/outline";
import { listRegistrationPaymentPromptsAction, registerPaymentAction } from "@/lib/actions/payments";
import { guardNetwork } from "@/lib/actions/network-guard";
import { useDraftOperationId } from "@/lib/lessons/use-draft-operation-id";
import { formatCivilDate, todayInArgentina } from "@/lib/format/date-format";
import { formatMoney } from "@/lib/format/number-format";
import { formatMoneyForInput } from "@/lib/format/money-input";
import { resolvePromptPayment, settleAfterRefresh, type PromptPaymentMode, type RegistrationPaymentPrompt } from "@/lib/payments/registration-payment-prompt";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, TextInput } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";

type PaymentMethod = "efectivo" | "transferencia" | "otro";
const METHODS: Array<{ value: PaymentMethod; label: string }> = [
  { value: "efectivo", label: "Efectivo" },
  { value: "transferencia", label: "Transferencia" },
  { value: "otro", label: "Otro" },
];

type View = "choose" | PromptPaymentMode | "exit";

/**
 * Aviso automático para registrar el pago de la clase recién guardada: el «Pago de {alumno}» de la app original (`ClassPaymentPromptModal`). Un diálogo compacto y centrado por alumno con
 * cobro pendiente, uno tras otro. Primero se elige cómo quedó el pago (cinco respuestas separadas); el formulario aparece recién al elegir una de las tres que registran dinero:
 *  - «Pagó el total»: saldo exigible (no editable), fecha de hoy y método;
 *  - «Pagó una parte»: importe (hasta el saldo), fecha de hoy y método;
 *  - «Ya había pagado»: fecha real del pago (hasta hoy), importe (hasta el saldo) y método;
 *  - «Quedó pendiente» y «Registrar después»: no registran dinero y pasan al siguiente alumno (el cobro queda pendiente en Cobros).
 * Cada pago va al cobro FIJO de ESA clase (`chargeId`, nunca reparte hacia otra deuda) con una clave de operación estable por cobro: si el pago falla o la respuesta se pierde, el reintento usa
 * la misma clave y el servidor no duplica pago ni asignación. Al elegir una respuesta que registra dinero se vuelve a leer el saldo (otro pago pudo registrarse desde otra pestaña): una clase ya
 * saldada no se cobra otra vez. El registro de la clase ya está guardado cuando esto se abre; cerrar sólo deja los cobros pendientes.
 */
export function ClassPaymentPrompt({ items, classLabel, registrationId, onFinished }: { items: RegistrationPaymentPrompt[]; classLabel: string; registrationId?: string; onFinished: () => void }) {
  const [index, setIndex] = useState(0);
  const item = items[index];
  if (!item) return null;
  const next = () => (index + 1 < items.length ? setIndex(index + 1) : onFinished());
  // `key` por cobro: al pasar al siguiente alumno se reinician importe, fecha, método, errores y la elección (nada se arrastra).
  return <PromptStep key={item.chargeId} item={item} classLabel={classLabel} registrationId={registrationId} position={index + 1} total={items.length} onNext={next} onExit={onFinished} />;
}

function PromptStep({
  item,
  classLabel,
  registrationId,
  position,
  total,
  onNext,
  onExit,
}: {
  item: RegistrationPaymentPrompt;
  classLabel: string;
  registrationId?: string;
  position: number;
  total: number;
  onNext: () => void;
  onExit: () => void;
}) {
  const uid = useId();
  const today = todayInArgentina();
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(false);
  const [view, setView] = useState<View>("choose");
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("efectivo");
  const [paidAt, setPaidAt] = useState(today);
  const [live, setLive] = useState({ paid: item.paid, balance: item.balance });
  const [refreshing, setRefreshing] = useState(false);
  const { operationId, clear } = useDraftOperationId(`teacherflow:registro:cobro:${item.chargeId}`);
  const settled = live.balance <= 0;

  async function refreshBalance() {
    if (!registrationId) return;
    setRefreshing(true);
    try {
      const result = await guardNetwork(() => listRegistrationPaymentPromptsAction({ registrationId, firstCompletion: true, knownChargeIds: [] }));
      // Si no se pudo leer, se sigue con el saldo conocido: el servidor valida igual contra el saldo real al registrar.
      if (result.error || !result.data) return;
      setLive(settleAfterRefresh(item, result.data.items.find((candidate) => candidate.chargeId === item.chargeId)));
    } finally {
      setRefreshing(false);
    }
  }

  function choose(mode: PromptPaymentMode) {
    setError(null);
    setPaidAt(today);
    setAmount(mode === "retroactive" ? formatMoneyForInput(live.balance) : "");
    setView(mode);
    void refreshBalance();
  }

  function back() {
    if (pending) return;
    setError(null);
    setView("choose");
  }

  function skip() {
    if (pending || inFlight.current) return;
    onNext();
  }

  function submit() {
    if (inFlight.current || pending || refreshing || !operationId || view === "choose" || view === "exit") return;
    setError(null);
    const resolved = resolvePromptPayment({ mode: view, amountRaw: amount, paidAt, today, balance: live.balance });
    if ("error" in resolved) {
      setError(resolved.error);
      return;
    }
    inFlight.current = true;
    startTransition(async () => {
      try {
        const result = await guardNetwork(() => registerPaymentAction({ operationId, studentId: item.studentId, amount: resolved.amount, method, paidAt: resolved.paidAt, chargeId: item.chargeId }));
        if (result.error) {
          // La clase ya está guardada y el cobro intacto: se puede reintentar (misma clave de operación, sin duplicar) o volver y elegir «Registrar después».
          setError(result.error);
          return;
        }
        clear();
        onNext();
      } finally {
        inFlight.current = false;
      }
    });
  }

  // Cerrar (X, Escape o fondo): durante un envío no hace nada; desde un formulario vuelve primero a las cinco respuestas; desde ellas advierte antes de salir.
  function beforeClose(): boolean {
    if (pending || inFlight.current) return false;
    setError(null);
    setView(view === "choose" ? "exit" : "choose");
    return false;
  }

  const isForm = view === "total" || view === "partial" || view === "retroactive";
  let footer: ReactNode = null;
  if (view === "exit") {
    footer = (
      <>
        <Button variant="secondary" onClick={onExit}>
          Salir
        </Button>
        <Button variant="primary" onClick={() => setView("choose")}>
          Seguir registrando
        </Button>
      </>
    );
  } else if (isForm && settled && !refreshing) {
    footer = (
      <>
        <Button variant="secondary" onClick={back}>
          Volver
        </Button>
        <Button variant="primary" onClick={onNext}>
          Seguir
        </Button>
      </>
    );
  } else if (isForm) {
    footer = (
      <>
        <Button variant="secondary" onClick={back} disabled={pending}>
          Volver
        </Button>
        <Button variant="primary" busy={pending} disabled={!operationId || refreshing} onClick={submit}>
          {pending ? "Guardando…" : "Confirmar"}
        </Button>
      </>
    );
  }

  return (
    <Dialog title={view === "exit" ? "Salir sin terminar" : `Pago de ${item.studentName}`} size="sm" placement="center" onClose={onExit} onBeforeClose={beforeClose} busy={pending || refreshing} footer={footer}>
      {view === "exit" ? (
        <p className="text-[15px] leading-relaxed text-textSecondary">Los alumnos que todavía no respondiste quedan con el cobro pendiente, visible en Cobros.</p>
      ) : (
        <>
          <div className="flex min-w-0 flex-col gap-0.5 text-[14px] text-textSecondary tf-num [overflow-wrap:anywhere]">
            <p>
              Clase de {formatMoney(item.total)}
              {total > 1 ? ` · Alumno ${position} de ${total}` : ""}
            </p>
            {classLabel && <p>{classLabel}</p>}
            {live.paid > 0 && (
              <p>
                Ya pagado {formatMoney(live.paid)} · Saldo {formatMoney(live.balance)}
              </p>
            )}
          </div>

          {view === "choose" && (
            <div className="flex flex-col gap-2">
              <PromptOption icon={CheckCircleIcon} tone="text-ok" label="Pagó el total" onClick={() => choose("total")} />
              <PromptOption icon={ChartPieIcon} tone="text-warn" label="Pagó una parte" onClick={() => choose("partial")} />
              <PromptOption icon={CalendarDaysIcon} tone="text-info" label="Ya había pagado" onClick={() => choose("retroactive")} />
              <PromptOption icon={ClockIcon} tone="text-bad" label="Quedó pendiente" onClick={skip} />
              <PromptOption icon={ArrowRightCircleIcon} tone="text-textSecondary" label="Registrar después" onClick={skip} />
            </div>
          )}

          {isForm && (
            <>
              {error && <Notice tone="bad">{error}</Notice>}
              {settled && !refreshing ? (
                <Notice tone="ok">Esta clase ya figura como pagada: no se registra otro pago.</Notice>
              ) : (
                <>
                  {view === "total" && <ReadOnlyValue label="Importe" value={formatMoney(live.balance)} />}
                  {view === "partial" && (
                    <Field label="Importe pagado" htmlFor={`${uid}-amount`} hint={`Hasta ${formatMoney(live.balance)}. El resto queda como saldo pendiente.`}>
                      <TextInput id={`${uid}-amount`} type="text" inputMode="decimal" autoComplete="off" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />
                    </Field>
                  )}
                  {view === "retroactive" && (
                    <>
                      <Field label="Fecha real del pago" htmlFor={`${uid}-paidAt`} hint="El día en que se pagó, hasta hoy.">
                        <TextInput id={`${uid}-paidAt`} type="date" value={paidAt} max={today} onChange={(e) => setPaidAt(e.target.value)} />
                      </Field>
                      <Field
                        label="Importe pagado"
                        htmlFor={`${uid}-amount`}
                        hint={live.paid > 0 ? `Ya hay ${formatMoney(live.paid)} registrados en esta clase: sólo se puede cargar hasta el saldo (${formatMoney(live.balance)}).` : `Hasta ${formatMoney(live.balance)}.`}
                      >
                        <TextInput id={`${uid}-amount`} type="text" inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} />
                      </Field>
                    </>
                  )}
                  {view !== "retroactive" && <ReadOnlyValue label="Fecha real del pago" value={formatCivilDate(today)} />}
                  <fieldset className="flex min-w-0 flex-col">
                    <legend className="mb-1.5 text-sm font-[650] text-textSecondary">Método</legend>
                    <div className="flex flex-wrap gap-2">
                      {METHODS.map((option) => {
                        const selected = method === option.value;
                        return (
                          <label
                            key={option.value}
                            className={`flex min-h-11 flex-auto cursor-pointer select-none items-center justify-center gap-1.5 rounded-md border-[1.5px] px-3 text-[15px] font-[650] transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ink has-[:focus-visible]:ring-offset-2 ${
                              selected ? "border-ink bg-ink text-background" : "border-borderStrong bg-surface text-textPrimary hover:border-ink"
                            }`}
                          >
                            <input type="radio" name={`${uid}-method`} value={option.value} checked={selected} onChange={() => setMethod(option.value)} disabled={pending} className="sr-only" />
                            {selected && <CheckIcon className="h-4 w-4 shrink-0" aria-hidden />}
                            {option.label}
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                </>
              )}
            </>
          )}
        </>
      )}
    </Dialog>
  );
}

function PromptOption({ icon: Icon, tone, label, onClick }: { icon: ComponentType<SVGProps<SVGSVGElement>>; tone: string; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-12 w-full items-center gap-3 rounded-md border-[1.5px] border-border bg-surface2 px-3.5 py-2 text-left text-[16px] font-[650] text-textPrimary transition-colors hover:border-ink hover:bg-white focus-visible:border-ink focus-visible:shadow-focus focus-visible:outline-none"
    >
      <Icon className={`h-5 w-5 shrink-0 ${tone}`} aria-hidden />
      <span className="min-w-0 flex-1">{label}</span>
      <ChevronRightIcon className="h-4 w-4 shrink-0 text-textMuted" aria-hidden />
    </button>
  );
}

function ReadOnlyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-[650] text-textSecondary">{label}</span>
      <p className="flex min-h-[46px] items-center rounded-md border-[1.5px] border-borderMid bg-paperDeep px-3.5 text-[16px] font-bold text-textPrimary tf-num">{value}</p>
    </div>
  );
}
