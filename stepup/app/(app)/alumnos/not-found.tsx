import { NotFoundView } from "@/components/ui/not-found-view";

export default function StudentNotFound() {
  return (
    <NotFoundView
      title="No encontramos a este alumno"
      message="Revisá el enlace o buscalo en tu lista de alumnos."
      actionLabel="Volver a Alumnos"
      actionHref="/alumnos"
      inShell
    />
  );
}
