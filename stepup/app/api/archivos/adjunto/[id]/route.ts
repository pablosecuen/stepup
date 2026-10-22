import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { serveLessonAttachment } from "@/lib/images/serve-attachment";

// Entrega un adjunto de clase (foto o PDF) a la sesión que lo pidió, por el propio servidor (el navegador no habla con Supabase). Privado: sin sesión → 401.
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const query = new URL(request.url).searchParams;
  return serveLessonAttachment(requireAuthenticatedDbContext, id, query.get("descargar") === "1", query.get("miniatura") === "1");
}
