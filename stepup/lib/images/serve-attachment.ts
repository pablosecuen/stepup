import type { AuthenticatedDbContext } from "../db/server-context.ts";
import { AttachmentNotAvailableError, AttachmentNotFoundError, getLessonAttachmentFile } from "../repositories/lesson-attachment-file.ts";
import { lessonFileHeaders } from "./lesson-file-headers.ts";

/**
 * Respuesta de la ruta `GET /api/archivos/adjunto/<id>` (con `?descargar=1` el archivo se baja en vez de mostrarse). El contexto autenticado lo resuelve la
 * ruta desde la cookie de sesión; acá nunca se confía en un identificador de cuenta que mande el cliente. Sin detalles internos en los errores.
 */
export async function serveLessonAttachment(resolveContext: () => Promise<AuthenticatedDbContext>, id: string, download: boolean, thumbnail = false): Promise<Response> {
  const plain = (status: number) => new Response(null, { status, headers: { "Cache-Control": "no-store" } });
  if (typeof id !== "string" || id.length === 0 || id.length > 64) return plain(404);
  let ctx: AuthenticatedDbContext;
  try {
    ctx = await resolveContext();
  } catch {
    return plain(401);
  }
  try {
    const file = await getLessonAttachmentFile(ctx, id);
    if (thumbnail) {
      // Miniatura (selección de evidencias del reporte, filas de fotos): JPEG chico hecho en el servidor, también para HEIC. Un PDF o un archivo que no es foto no tiene miniatura.
      try {
        const { toThumbnailJpeg } = await import("../reports/evidence-image.ts");
        const jpeg = await toThumbnailJpeg(new Uint8Array(await file.blob.arrayBuffer()));
        return new Response(Buffer.from(jpeg), { status: 200, headers: lessonFileHeaders({ mime: "image/jpeg", name: "miniatura.jpg", size: jpeg.byteLength, download: false }) });
      } catch {
        // 422: el archivo existe pero no se puede leer como foto (HEIC inválido, dañado o un PDF): la pantalla lo marca como no utilizable en vez de mostrar una miniatura rota.
        return plain(422);
      }
    }
    return new Response(file.blob.stream(), { status: 200, headers: lessonFileHeaders({ mime: file.mimeType, name: file.name, size: file.blob.size, download }) });
  } catch (error) {
    if (error instanceof AttachmentNotFoundError || error instanceof AttachmentNotAvailableError) return plain(404);
    return plain(500);
  }
}
