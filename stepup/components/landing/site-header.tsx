import Image from "next/image";
import { ButtonLink } from "@/components/auth/public-links";

const LINKS = [
  { href: "#producto", label: "Producto" },
  { href: "#recorrido-pantallas", label: "Recorrido" },
  { href: "#calendario", label: "Calendario" },
  { href: "#alumnos", label: "Alumnos" },
  { href: "#cobros", label: "Cobros" },
  { href: "#seguridad", label: "Seguridad" },
  { href: "/planes", label: "Planes" },
] as const;

/** Encabezado fijo de la landing: anclas a cada escena (scroll suave con «sin reducir movimiento») y los dos accesos. */
export function SiteHeader() {
  return (
    <header className="tf-header sticky top-0 z-40 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[1240px] items-center justify-between gap-3 px-4 py-2 nav:px-10">
        <a href="#top" aria-label="TeacherFlow, ir al comienzo" className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2">
          <span className="inline-flex items-center gap-2.5 font-display text-xl font-semibold tracking-tight">
            <Image src="/icon.png" alt="" width={34} height={34} className="rounded-[9px]" priority />
            <span className="max-[440px]:sr-only">TeacherFlow</span>
          </span>
        </a>
        <nav aria-label="Secciones de la página" className="hidden items-center gap-1 lg:flex">
          <details className="tf-product-nav relative">
            <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md px-3 text-[14.5px] font-[650] text-textSecondary transition-colors duration-200 hover:bg-paperDeep hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
              Producto <span aria-hidden>⌄</span>
            </summary>
            <div className="tf-product-menu absolute left-0 top-full z-50 grid min-w-[220px] gap-1 rounded-2xl border border-border bg-surface p-2">
              {LINKS.filter((link) => link.href !== "/planes" && link.href !== "#recorrido-pantallas").map((link) => (
                <a key={link.href} href={link.href} className="flex min-h-11 items-center rounded-lg px-3 text-[14.5px] font-[650] text-textSecondary transition-colors duration-200 hover:bg-paperDeep hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
                  {link.href === "#producto" ? "Todo TeacherFlow" : link.label}
                </a>
              ))}
            </div>
          </details>
          <a href="#recorrido-pantallas" className="inline-flex min-h-11 items-center rounded-md px-3 text-[14.5px] font-[650] text-textSecondary transition-colors duration-200 hover:bg-paperDeep hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">Cómo funciona</a>
          <a href="/planes" className="inline-flex min-h-11 items-center rounded-md px-3 text-[14.5px] font-[650] text-textSecondary transition-colors duration-200 hover:bg-paperDeep hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">Planes</a>
        </nav>
        <div className="flex items-center gap-1.5 nav:gap-2">
          <ButtonLink href="/login" variant="ghost" className="tf-ctl whitespace-nowrap px-3 nav:px-[18px] nav:text-[14.5px]">
            Iniciar sesión
          </ButtonLink>
          <ButtonLink href="/crear-cuenta" variant="accent" className="tf-ctl whitespace-nowrap px-3 nav:px-[18px] nav:text-[14.5px]">
            Crear cuenta
          </ButtonLink>
        </div>
      </div>
    </header>
  );
}
