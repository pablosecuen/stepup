import { PageSkeleton } from "@/components/ui/page-skeleton";

// Esqueleto propio de esta pantalla (su ancho y su estructura): sin él heredaría el de la sección y el contenido real "saltaría" al llegar.
export default function Loading() {
  return <PageSkeleton label="Cargando el comportamiento de pago…" variant="finance" />;
}
