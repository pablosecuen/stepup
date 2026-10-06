import type { StudentRecord } from "@/lib/repositories/students-mapping";
import type { StatusHistoryRecord, LevelHistoryRecord, PriceHistoryRecord } from "@/lib/repositories/student-history-mapping";
import { CATEGORY_LABEL, BILLING_LABEL, STUDENT_STATUS_LABEL } from "@/lib/students/constants";
import { formatCivilDate } from "@/lib/format/date-format";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="text-textMuted">{label}</span>
      <span className="text-right text-textPrimary">{value}</span>
    </div>
  );
}

function formatDate(dateKey: string | null): string {
  return formatCivilDate(dateKey);
}

function formatCurrencyARS(amount: number): string {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(amount);
}

export function InformacionTabContent({
  student,
  statusHistory,
  levelHistory,
  priceHistory,
}: {
  student: StudentRecord;
  statusHistory: StatusHistoryRecord[];
  levelHistory: LevelHistoryRecord[];
  priceHistory: PriceHistoryRecord[];
}) {
  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-lg border border-border bg-surface p-4 shadow-card">
        <h2 className="text-sm font-semibold text-textPrimary">Datos generales</h2>
        <div className="mt-2 divide-y divide-border">
          <Row label="Nivel inicial" value={student.initialLevel || "—"} />
          <Row label="Niveles actuales" value={student.levels.length > 0 ? student.levels.join(", ") : "—"} />
          <Row label="Fecha de alta" value={formatDate(student.dateJoined)} />
          {student.lastReactivatedAt && <Row label="Última reactivación" value={formatDate(student.lastReactivatedAt)} />}
          {student.statusChangeDate && <Row label="Fecha de pausa/archivo" value={formatDate(student.statusChangeDate)} />}
          <Row label="Duración habitual" value={`${student.usualDurationMinutes} min`} />
          <Row label="Frecuencia semanal" value={`${student.weeklyFrequency}x por semana`} />
          <Row label="Categoría" value={CATEGORY_LABEL[student.category]} />
          <Row label="Tipo de facturación" value={BILLING_LABEL[student.billingType]} />
          <Row label="Precio de referencia" value={formatCurrencyARS(student.price)} />
        </div>
      </section>

      <section className="rounded-lg border border-border bg-surface p-4 shadow-card">
        <h2 className="text-sm font-semibold text-textPrimary">Contacto</h2>
        <div className="mt-2 divide-y divide-border">
          <Row label="Teléfono" value={student.phone ?? "—"} />
          <Row label="WhatsApp" value={student.whatsapp ?? "—"} />
          <Row label="Email" value={student.email ?? "—"} />
        </div>
      </section>

      {student.notes && (
        <section className="rounded-lg border border-border bg-surface p-4 shadow-card">
          <h2 className="text-sm font-semibold text-textPrimary">Notas</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-textSecondary">{student.notes}</p>
        </section>
      )}

      <section className="rounded-lg border border-border bg-surface p-4 shadow-card">
        <h2 className="text-sm font-semibold text-textPrimary">Historial de cambios de estado</h2>
        {statusHistory.length > 0 ? (
          <ul className="mt-2 flex flex-col gap-2">
            {statusHistory.map((entry) => (
              <li key={entry.id} className="text-sm text-textSecondary">
                <span className="font-medium text-textPrimary">{STUDENT_STATUS_LABEL[entry.status]}</span> — {formatDate(entry.occurredOn)}
                {entry.reason && <> · Motivo: {entry.reason}</>}
                {entry.internalNote && <> · Observación: {entry.internalNote}</>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-textMuted">Sin cambios de estado registrados.</p>
        )}
      </section>

      <section className="rounded-lg border border-border bg-surface p-4 shadow-card">
        <h2 className="text-sm font-semibold text-textPrimary">Historial de nivel</h2>
        {levelHistory.length > 0 ? (
          <ul className="mt-2 flex flex-col gap-2">
            {levelHistory.map((entry) => (
              <li key={entry.id} className="text-sm text-textSecondary">
                <span className="font-medium text-textPrimary">{entry.level}</span> — {formatDate(entry.achievedOn)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-textMuted">Sin hitos de nivel registrados.</p>
        )}
      </section>

      <section className="rounded-lg border border-border bg-surface p-4 shadow-card">
        <h2 className="text-sm font-semibold text-textPrimary">Historial de precios</h2>
        {priceHistory.length > 0 ? (
          <ul className="mt-2 flex flex-col gap-2">
            {priceHistory.map((entry) => (
              <li key={entry.id} className="text-sm text-textSecondary">
                <span className="font-medium text-textPrimary">{formatCurrencyARS(entry.price)}</span> — {formatDate(entry.effectiveOn)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-textMuted">Sin historial de precios registrado.</p>
        )}
      </section>
    </div>
  );
}
