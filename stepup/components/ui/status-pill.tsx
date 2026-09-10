import type { FixtureStudentStatus } from "@/lib/fixtures";

// Mismo criterio que TeacherFlow móvil: un estado importante nunca se
// comunica sólo por color — siempre va acompañado de texto.
const STATUS_STYLES: Record<FixtureStudentStatus, string> = {
  Pagado: "bg-statusVerde/10 text-statusVerde",
  "Pago pendiente": "bg-statusPendiente/10 text-statusPendiente",
  "Vence pronto": "bg-statusAmarillo/10 text-statusAmarillo",
  "Vence hoy": "bg-statusNaranja/10 text-statusNaranja",
  "Pago vencido": "bg-statusRojo/10 text-statusRojo",
};

export function StatusPill({ status }: { status: FixtureStudentStatus }) {
  return (
    <span className={`shrink-0 rounded-pill px-2.5 py-1 text-xs font-semibold tracking-tight ${STATUS_STYLES[status]}`}>
      {status}
    </span>
  );
}
