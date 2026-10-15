import { PageSkeleton } from "@/components/ui/page-skeleton";

// Se muestra dentro del shell mientras el servidor prepara la pantalla, con la geometría de la pantalla final (sin saltos de diseño).
export default function Loading() {
  return <PageSkeleton label="Cargando registro de clases…" variant="list" />;
}
