import type { ComponentType, SVGProps } from "react";
import { BanknotesIcon, ClipboardDocumentCheckIcon, ExclamationCircleIcon, UserGroupIcon } from "@heroicons/react/24/outline";
import type { BadgeTone } from "@/components/ui/badge";
import type { ReminderCategoryKind } from "@/lib/dashboard/reminders-center";

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

/** Ícono y tono de cada una de las cuatro categorías reales de recordatorios (Inicio y /recordatorios usan los mismos). */
export const REMINDER_ICONS: Record<ReminderCategoryKind, { icon: IconComponent; tone: BadgeTone }> = {
  clases_sin_alumnos: { icon: UserGroupIcon, tone: "warn" },
  clases_sin_registrar: { icon: ClipboardDocumentCheckIcon, tone: "warn" },
  pagos_por_vencer: { icon: BanknotesIcon, tone: "warn" },
  pagos_vencidos: { icon: ExclamationCircleIcon, tone: "bad" },
};
