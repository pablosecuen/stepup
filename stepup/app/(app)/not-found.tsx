import { NotFoundView } from "@/components/ui/not-found-view";

// `notFound()` lanzado desde una pantalla privada sin un not-found más específico: queda dentro del shell.
export default function PrivateNotFound() {
  return (
    <NotFoundView
      title="No encontramos lo que buscás"
      message="Puede que el enlace esté incompleto o que ya no exista."
      actionLabel="Ir a Inicio"
      actionHref="/inicio"
      inShell
    />
  );
}
