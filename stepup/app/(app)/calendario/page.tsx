import { WeekCalendar } from "@/components/calendar/week-calendar";

export const metadata = { title: "Calendario · TeacherFlow" };

// Revisión visual: grilla semanal real (réplica de la app móvil — misma
// escala de colores congelada, mismos indicadores de entrenamiento/clase
// grupal/cancelada/reemplazo), sobre datos exclusivamente ficticios.
export default function CalendarioPage() {
  return (
    <div>
      <div className="px-4 pt-8 sm:px-8 sm:pt-10">
        <h1 className="text-[26px] font-bold leading-tight tracking-tight text-textPrimary">Calendario</h1>
        <p className="mt-1.5 text-sm text-textMuted">
          Datos de ejemplo — tocá una clase para ver el detalle de vista previa.
        </p>
      </div>
      <WeekCalendar />
    </div>
  );
}
