import { NotFoundView } from "@/components/ui/not-found-view";

export default function RegistrationNotFound() {
  return (
    <NotFoundView
      title="No encontramos este registro"
      message="Puede que la clase ya no exista o que el enlace sea incorrecto."
      actionLabel="Volver a Registro"
      actionHref="/registro"
      inShell
    />
  );
}
