"use client";

import { useId, useState, useTransition } from "react";
import { registerPaymentAction } from "@/lib/actions/payments";
import { guardNetwork } from "@/lib/actions/network-guard";
import { useDraftOperationId } from "@/lib/lessons/use-draft-operation-id";
import { todayInArgentina } from "@/lib/format/date-format";
import { formatMoney } from "@/lib/format/number-format";
import { formatMoneyForInput } from "@/lib/format/money-input";
import { validatePromptAmount, type RegistrationPaymentPrompt } from "@/lib/payments/registration-payment-prompt";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, SelectInput, TextInput } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { DialogContext } from "@/components/payments/dialog-context";

const METHOD_LABEL: Record<string, string> = { efectivo: "Efectivo", transferencia: "Transferencia", otro: "Otro" };

/**
 * Aviso automático para registrar el pago de la clase recién guardada (equivalente web del «¿cómo quedó el pago?» de la app original). Un diálogo por alumno con cobro
 * pendiente, uno tras otro. Cada uno identifica alumno, clase, importe y saldo real y permite registrar el pago de ESE cobro (`chargeId` fijo, nunca reparte hacia otra
 * deuda) o elegir «Más tarde» (el cobro queda pendiente, nada se pierde). La clave de la operación es estable por cobro: si el pago falla, se reintenta con la misma
 * clave y el servidor no duplica pago ni asignación. El registro de la clase ya está guardado cuando esto se abre.
 */
export function ClassPaymentPrompt({ items, classLabel, onFinished }: { items: RegistrationPaymentPrompt[]; classLabel: string; onFinished: () => void }) {
  const [index, setIndex] = useState(0);
  const item = items[index];
  if (!item) return null;
  const next = () => (index + 1 < items.length ? setIndex(index + 1) : onFinished());
  return <PromptStep key={item.chargeId} item={item} classLabel={classLabel} position={index + 1} total={items.length} onNext={next} />;
}

function PromptStep({ item, classLabel, position, total, onNext }: { item: RegistrationPaymentPrompt; classLabel: string; position: number; total: number; onNext: () => void }) {
  const uid = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState(formatMoneyForInput(item.balance));
  const [method, setMethod] = useState("efectivo");
  const [paidAt, setPaidAt] = useState(() => todayInArgentina());
  const { operationId, clear } = useDraftOperationId(`teacherflow:registro:cobro:${item.chargeId}`);

  function submit() {
    setError(null);
    const parsed = validatePromptAmount(amount, item.balance);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    if (!operationId) return;
    startTransition(async () => {
      const result = await guardNetwork(() => registerPaymentAction({ operationId, studentId: item.studentId, amount: parsed.amount, method: method as "efectivo" | "transferencia" | "otro", paidAt, chargeId: item.chargeId }));
      if (result.error) {
        // La clase ya está guardada y el cobro intacto: se puede reintentar (misma clave de operación, sin duplicar) o elegir «Más tarde».
        setError(result.error);
        return;
      }
      clear();
      onNext();
    });
  }

  return (
    <Dialog
      title={`Pago de ${item.studentName}`}
      size="sm"
      onClose={onNext}
      busy={pending}
      footer={
        <>
          <Button variant="secondary" onClick={onNext} disabled={pending}>
            Más tarde
          </Button>
          <Button variant="primary" busy={pending} disabled={!operationId} onClick={submit}>
            {pending ? "Guardando…" : "Registrar pago"}
          </Button>
        </>
      }
    >
      <DialogContext
        title={item.studentName}
        lines={[
          classLabel,
          `Importe de la clase: ${formatMoney(item.total)}`,
          item.paid > 0 ? `Ya pagado: ${formatMoney(item.paid)}` : null,
          `Saldo: ${formatMoney(item.balance)}`,
          total > 1 ? `Alumno ${position} de ${total}` : null,
        ]}
      />
      {error && <Notice tone="bad">{error}</Notice>}
      <Field label="Importe que pagó" htmlFor={`${uid}-amount`} hint="Si pagó una parte, cargá lo que recibiste: el resto queda como saldo pendiente.">
        <TextInput id={`${uid}-amount`} type="text" inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <Field label="Método" htmlFor={`${uid}-method`}>
        <SelectInput id={`${uid}-method`} value={method} onChange={(e) => setMethod(e.target.value)}>
          {Object.entries(METHOD_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </SelectInput>
      </Field>
      <Field label="Fecha real del pago" htmlFor={`${uid}-paidAt`} hint="Si ya había pagado antes, poné el día en que lo hizo.">
        <TextInput id={`${uid}-paidAt`} type="date" value={paidAt} max={todayInArgentina()} onChange={(e) => setPaidAt(e.target.value)} />
      </Field>
    </Dialog>
  );
}
