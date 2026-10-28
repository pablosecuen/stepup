// Puerto VERBATIM del original (`src/features/account/utils/teacherName.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección 2026-07-22 (a pedido de Joaquín — autenticación, teclado,
 * correo y nombre de la profesora): normalización y validación PURAS del
 * nombre de la profesora, compartidas por la pantalla de onboarding ("Hola,
 * ¿cómo te llamás?") y la edición posterior desde Configuración → Perfil de
 * la profesora — nunca una segunda implementación.
 */

const MAX_NAME_LENGTH = 60;

/**
 * Quita espacios al inicio/final y colapsa espacios internos repetidos a
 * uno solo. Nunca toca tildes, ñ, apóstrofes ni guiones — nombres
 * compuestos ("María José", "Ana-Laura", "O'Connor") quedan intactos.
 */
export function normalizeTeacherName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/**
 * Válido si, después de normalizar, queda al menos una letra real (Unicode,
 * cubre tildes/ñ) — nunca acepta un valor formado sólo por espacios,
 * números o símbolos. No exige apellido: una sola palabra alcanza.
 */
export function isValidTeacherName(raw: string): boolean {
  const normalized = normalizeTeacherName(raw);
  if (normalized.length === 0 || normalized.length > MAX_NAME_LENGTH) return false;
  return /\p{L}/u.test(normalized);
}
