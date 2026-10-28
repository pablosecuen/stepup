// Puerto VERBATIM del original (`src/features/new-class/utils/__tests__/lessonAttachments.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';
import { resolveAttachmentKind } from '../attachmentKind.ts';

/**
 * Corrección 2026-07-18: `LessonAttachment.kind` es opcional a propósito —
 * un adjunto guardado antes de admitir fotos nunca tiene este campo y debe
 * seguir tratándose como PDF, nunca reinterpretado como imagen.
 */
test('resolveAttachmentKind: un adjunto sin "kind" (formato anterior) se resuelve siempre como pdf', () => {
  assertEqual(resolveAttachmentKind({}), 'pdf', 'compatibilidad con adjuntos guardados antes de este cambio');
});

test('resolveAttachmentKind: respeta "kind" cuando está presente', () => {
  assertEqual(resolveAttachmentKind({ kind: 'image' }), 'image', 'respeta kind: image');
  assertEqual(resolveAttachmentKind({ kind: 'pdf' }), 'pdf', 'respeta kind: pdf');
});
