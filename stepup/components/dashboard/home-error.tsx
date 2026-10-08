import Link from "@/components/nav/private-link";
import { ErrorState } from "@/components/ui/states";
import { linkClass } from "@/components/ui/button";

/** Error de carga de Inicio (sesión vencida, sesión todavía no reconocida o fallo general): mensaje en línea y «Reintentar». */
export function HomeLoadError({ message }: { message: string }) {
  return (
    <div className="mx-auto w-full max-w-[960px] px-4 py-5 nav:px-10 nav:py-[30px]">
      <h1 className="mb-4 font-display text-[30px] font-medium leading-[1.08] tracking-[-0.025em] nav:text-page">Inicio</h1>
      <ErrorState message={message} />
      <Link href="/inicio" className={`mt-3 ${linkClass()}`}>
        Reintentar
      </Link>
    </div>
  );
}
