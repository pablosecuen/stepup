import type { StudentRecord } from "@/lib/repositories/students-mapping";
import type { StatusHistoryRecord, LevelHistoryRecord, PriceHistoryRecord } from "@/lib/repositories/student-history-mapping";
import { CATEGORY_LABEL, STUDENT_STATUS_LABEL } from "@/lib/students/constants";
import type { ProfileClassStats } from "@/lib/students/profile-overview";
import { resolveStudentBillingPlan, type StudentBillingPlan } from "@/lib/payments/billing-plan";
import { describePlan } from "@/lib/payments/plan-form";
import { formatHours, formatMinutes, formatMoney } from "@/lib/format/number-format";
import { formatCivilDate } from "@/lib/format/date-format";
import { Card } from "@/components/ui/card";

/** Una fila «dato — valor»: el valor se parte si es largo (nunca desborda) y las filas se separan con una línea fina. */
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-border py-2.5 text-[15px] last:border-b-0">
      <dt className="text-textMuted">{label}</dt>
      <dd className="min-w-0 text-right font-[550] tf-num text-textPrimary [overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <Card>
        <h2 className="font-display text-card font-semibold">{title}</h2>
        {children}
      </Card>
    </section>
  );
}

function formatDate(dateKey: string | null): string {
  return formatCivilDate(dateKey);
}

const STATUS_CHANGE_LABEL: Partial<Record<StudentRecord["status"], string>> = {
  pausado: "Pausado desde",
  inactivo: "Inactivo desde",
  archivado: "Archivado el",
};

export function InformacionTabContent({
  student,
  statusHistory,
  levelHistory,
  priceHistory,
  stats,
  totalCollected,
}: {
  student: StudentRecord;
  statusHistory: StatusHistoryRecord[];
  levelHistory: LevelHistoryRecord[];
  priceHistory: PriceHistoryRecord[];
  stats: ProfileClassStats;
  totalCollected: number;
}) {
  const planDescription = describePlan(resolveStudentBillingPlan({ billingPlan: student.billingPlan as StudentBillingPlan | null, billingType: student.billingType, price: student.price }));
  const statusChangeLabel = STATUS_CHANGE_LABEL[student.status];
  return (
    <div className="flex flex-col gap-3.5">
      <div className="grid grid-cols-1 items-start gap-3.5 md:grid-cols-2">
        <Section title="Datos generales">
          <dl className="mt-2">
            <Row label="Nivel inicial" value={student.initialLevel || "—"} />
            <Row label="Niveles actuales" value={student.levels.length > 0 ? student.levels.join(", ") : "—"} />
            <Row label="Fecha de alta" value={formatDate(student.dateJoined)} />
            {student.lastReactivatedAt && <Row label="Última reactivación" value={formatDate(student.lastReactivatedAt)} />}
            {statusChangeLabel && student.statusChangeDate && <Row label={statusChangeLabel} value={formatDate(student.statusChangeDate)} />}
            <Row label="Duración habitual" value={formatMinutes(student.usualDurationMinutes)} />
            <Row label="Frecuencia semanal" value={`${student.weeklyFrequency}x por semana`} />
            <Row label="Categoría" value={CATEGORY_LABEL[student.category]} />
            <Row label="Plan de cobro" value={planDescription.title} />
            {planDescription.lines.map((line) => (
              <Row key={line} label="" value={line} />
            ))}
          </dl>
        </Section>

        <div className="flex flex-col gap-3.5">
          <Section title="Actividad">
            <dl className="mt-2">
              <Row label="Clases dictadas" value={String(stats.classesHeld)} />
              {stats.hours !== null && <Row label="Horas de clase" value={formatHours(stats.hours)} />}
              <Row label="Total cobrado" value={formatMoney(totalCollected)} />
            </dl>
            <p className="mt-2 text-[13px] text-textMuted">
              Cuenta sólo clases finalizadas a las que el alumno asistió (las horas, además, con horario conocido) y pagos vigentes.
            </p>
          </Section>

          <Section title="Contacto">
            <dl className="mt-2">
              <Row label="Teléfono" value={student.phone ?? "—"} />
              <Row label="WhatsApp" value={student.whatsapp ?? "—"} />
              <Row label="Email" value={student.email ?? "—"} />
            </dl>
          </Section>
        </div>
      </div>

      {student.notes && (
        <Section title="Notas">
          <p className="mt-2 whitespace-pre-wrap text-[15px] text-textSecondary [overflow-wrap:anywhere]">{student.notes}</p>
        </Section>
      )}

      <div className="grid grid-cols-1 items-start gap-3.5 md:grid-cols-3">
        <Section title="Historial de cambios de estado">
          {statusHistory.length > 0 ? (
            <ul className="mt-2">
              {statusHistory.map((entry) => (
                <li key={entry.id} className="border-b border-border py-2.5 text-[14.5px] text-textSecondary last:border-b-0 [overflow-wrap:anywhere]">
                  <span className="font-[650] text-textPrimary">{STUDENT_STATUS_LABEL[entry.status]}</span> — {formatDate(entry.occurredOn)}
                  {entry.reason && <> · Motivo: {entry.reason}</>}
                  {entry.internalNote && <> · Observación: {entry.internalNote}</>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[14.5px] text-textMuted">Sin cambios de estado registrados.</p>
          )}
        </Section>

        <Section title="Historial de nivel">
          {levelHistory.length > 0 ? (
            <ul className="mt-2">
              {levelHistory.map((entry) => (
                <li key={entry.id} className="border-b border-border py-2.5 text-[14.5px] text-textSecondary last:border-b-0 [overflow-wrap:anywhere]">
                  <span className="font-[650] text-textPrimary">{entry.level}</span> — {formatDate(entry.achievedOn)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[14.5px] text-textMuted">Sin hitos de nivel registrados.</p>
          )}
        </Section>

        <Section title="Historial de precios">
          {priceHistory.length > 0 ? (
            <ul className="mt-2">
              {priceHistory.map((entry) => (
                <li key={entry.id} className="border-b border-border py-2.5 text-[14.5px] text-textSecondary last:border-b-0 [overflow-wrap:anywhere]">
                  <span className="font-[650] tf-num text-textPrimary">{formatMoney(entry.price)}</span> — {formatDate(entry.effectiveOn)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[14.5px] text-textMuted">Sin historial de precios registrado.</p>
          )}
        </Section>
      </div>
    </div>
  );
}
