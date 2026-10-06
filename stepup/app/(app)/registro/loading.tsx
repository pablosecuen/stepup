import { PageSkeleton } from "@/components/ui/page-skeleton";

// Se muestra dentro del shell mientras el servidor prepara la pantalla (navegación entre secciones).
export default function Loading() {
  return <PageSkeleton label="Cargando registro de clases…" />;
}
