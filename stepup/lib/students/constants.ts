import type { BillingType, StudentCategory, StudentModality, StudentStatus } from "../db/database.types.ts";

/**
 * Constantes de dominio de Alumnos — copiadas del móvil
 * (`src/features/students/types/index.ts`, `customLevelsCore.ts`,
 * `InformacionTab.tsx`). Nunca se inventan valores nuevos acá.
 */
export const STANDARD_LEVELS: readonly string[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

export const STUDENT_STATUS_OPTIONS: readonly StudentStatus[] = ["activo", "pausado", "inactivo", "archivado"];

export const STUDENT_STATUS_LABEL: Record<StudentStatus, string> = {
  activo: "Activo",
  pausado: "Pausado",
  inactivo: "Inactivo",
  archivado: "Archivado",
};

export const MODALITY_OPTIONS: readonly StudentModality[] = ["presencial", "online", "mixta"];

export const MODALITY_LABEL: Record<StudentModality, string> = {
  presencial: "Presencial",
  online: "Online",
  mixta: "Mixta",
};

export const CATEGORY_OPTIONS: readonly StudentCategory[] = [
  "primaria",
  "secundaria",
  "profesorado_ingles",
  "universitario",
  "adulto_interes_personal",
  "adulto_laboral",
  "examen_internacional",
  "apoyo_escolar",
  "otro",
];

// Copiado tal cual de InformacionTab.tsx (móvil) — nunca reinventado.
export const CATEGORY_LABEL: Record<StudentCategory, string> = {
  primaria: "Primaria",
  secundaria: "Secundaria",
  profesorado_ingles: "Estudiante de profesorado de inglés",
  universitario: "Estudiante universitario",
  adulto_interes_personal: "Adulto por interés personal",
  adulto_laboral: "Adulto por motivos laborales",
  examen_internacional: "Preparación de examen internacional",
  apoyo_escolar: "Apoyo escolar",
  otro: "Otro",
};

export const BILLING_TYPE_OPTIONS: readonly BillingType[] = ["por_clase", "mensual"];

export const BILLING_LABEL: Record<BillingType, string> = {
  por_clase: "Por clase",
  mensual: "Mensual",
};
