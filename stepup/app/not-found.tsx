import { NotFoundView } from "@/components/ui/not-found-view";

export const metadata = { title: "Página no encontrada · TeacherFlow" };

// URL que no existe (en cualquier parte de la app).
export default function NotFound() {
  return (
    <NotFoundView
      title="No encontramos esta página"
      message="Puede que el enlace esté incompleto o que la página ya no exista."
      actionLabel="Ir a Inicio"
      actionHref="/inicio"
      inShell={false}
    />
  );
}
