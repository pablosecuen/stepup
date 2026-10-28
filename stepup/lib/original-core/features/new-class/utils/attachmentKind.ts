// Puerto VERBATIM del original (`src/features/new-class/utils/attachmentKind.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { LessonAttachment, LessonAttachmentKind } from '../types/index.ts';

/**
 * Corrección 2026-07-18: separado de `lessonAttachments.ts` a propósito —
 * ese archivo importa `expo-document-picker`/`expo-image-picker`/
 * `expo-file-system` (módulos nativos), que no se pueden cargar bajo Node
 * puro en las pruebas automatizadas. Esta función es la única parte de la
 * lógica de adjuntos que necesita cobertura de pruebas sin infraestructura
 * nativa, así que vive en su propio archivo sin ningún import nativo.
 *
 * Un adjunto guardado antes de admitir fotos nunca tiene `kind` — se trata
 * siempre como PDF, nunca se reinterpreta como imagen.
 */
export function resolveAttachmentKind(attachment: Pick<LessonAttachment, 'kind'>): LessonAttachmentKind {
  return attachment.kind ?? 'pdf';
}
