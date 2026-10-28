import PrivateLink from "@/components/nav/private-link";
import { Card } from "@/components/ui/card";
import { buttonClass } from "@/components/ui/button";
import { PageHeader, PAGE_WIDTH } from "@/components/ui/page-header";
import { MODALITY_COLORS, MODALITY_LABELS, CANCELLED_COLORS, ELAPSED_COLORS, REPLACEMENT_COLORS, CLOSED_OUTCOME_LABELS } from "@/lib/calendar-theme";

export const metadata = { title: "Información del calendario · TeacherFlow" };

export default async function CalendarInformationPage({ searchParams }: { searchParams: Promise<{ volver?: string }> }) {
  const { volver } = await searchParams;
  const returnHref = volver === "/calendario" || volver?.startsWith("/calendario?") ? volver : "/calendario";
  const colors = [
    ...Object.entries(MODALITY_COLORS).map(([key, palette]) => ({ ...palette, label: MODALITY_LABELS[key as keyof typeof MODALITY_LABELS], text: "Modalidad de la clase." })),
    { ...CANCELLED_COLORS, label: "Cancelada", text: "El estado también aparece con texto o un indicador; no se distingue sólo por el color." },
    { ...ELAPSED_COLORS, label: "Transcurrida", text: "Terminó su horario. Eso no significa que ya esté registrada." },
    { ...REPLACEMENT_COLORS, label: "Reemplazo activo", text: "Otra clase ocupa el espacio de una cancelación vinculada. Al transcurrir su horario usa el gris." },
  ];
  return <div className={PAGE_WIDTH.medium}>
    <PrivateLink href={returnHref} className={buttonClass({ variant: "ghost" })}>← Volver al Calendario</PrivateLink>
    <PageHeader title="Información" subtitle="Qué significa cada color y cada indicador del Calendario." />
    <div className="mt-5 flex flex-col gap-4">
      <Card><h2 className="font-display text-card font-semibold">Colores de las clases</h2><ul className="mt-3 divide-y divide-border">{colors.map((entry) => <li key={entry.label} className="flex items-start gap-3 py-3"><span aria-hidden className="mt-1 h-8 w-10 shrink-0 rounded-md border-2" style={{ backgroundColor: entry.bg, borderColor: entry.border }} /><div><h3 className="font-semibold">{entry.label}</h3><p className="text-textSecondary">{entry.text}</p></div></li>)}</ul><p className="mt-3 text-sm text-textMuted">Completada y reprogramada conservan su modalidad cuando no corresponde otro color. La cancelación tiene prioridad sobre los demás colores.</p></Card>
      <Card><h2 className="font-display text-card font-semibold">Estados e indicadores</h2><dl className="mt-3 space-y-3">
        <div><dt className="font-semibold">Programada</dt><dd>Clase agendada, todavía sin finalizar su registro.</dd></div>
        <div><dt className="font-semibold">Completada</dt><dd>Registro finalizado. Si no se dictó, el detalle muestra el resultado real: {Object.values(CLOSED_OUTCOME_LABELS).join(", ")}.</dd></div>
        <div><dt className="font-semibold">Reprogramada</dt><dd>Clase trasladada a otra fecha u horario.</dd></div>
        <div><dt className="font-semibold">Grupo y entrenamiento</dt><dd>El ícono de personas identifica un grupo; la pesa identifica un entrenamiento. No cambian el color de la modalidad.</dd></div>
        <div><dt className="font-semibold">No se dictó</dt><dd>Se indica con ⊘ o una franja rayada cuando la tarjeta es muy angosta. Tocá la clase para leer el resultado completo.</dd></div>
        <div><dt className="font-semibold">Clases cortas</dt><dd>La barra conserva su duración exacta. El rótulo muestra la hora y el nombre; los números relacionan barras y rótulos simultáneos.</dd></div>
      </dl></Card>
      <Card><h2 className="font-display text-card font-semibold">Disponibilidad y series</h2><p className="mt-3">Los bloqueos de trabajo, estudio, motivos personales, vacaciones, feriados o licencias no son clases. Se administran en Mi disponibilidad.</p><p className="mt-3">Una serie repite un patrón semanal. Abrí una clase y elegí «Administrar esta serie» para modificar la serie correspondiente. Los cambios desde una fecha conservan lo anterior.</p><div className="mt-4 flex flex-wrap gap-2"><PrivateLink href="/calendario/disponibilidad" className={buttonClass({ variant: "secondary" })}>Mi disponibilidad</PrivateLink><PrivateLink href="/configuracion/tutorial" className={buttonClass({ variant: "secondary" })}>Ver tutorial de TeacherFlow</PrivateLink></div></Card>
      <Card><h2 className="font-display text-card font-semibold">Ayuda rápida</h2><p className="mt-3">Tocá un espacio libre para crear una clase con esa fecha y hora. Tocá una tarjeta para abrir sus acciones. Semana y Día comparten las mismas clases; al deslizar la grilla no se crea ninguna.</p></Card>
    </div>
  </div>;
}
