import Image from "next/image";
import Link from "next/link";
import type { ComponentType, ReactNode, SVGProps } from "react";
import { BanknotesIcon, CalendarDaysIcon, UsersIcon } from "@heroicons/react/24/outline";
import { BrandMark } from "@/components/ui/brand";
import { TextLink } from "@/components/auth/public-links";
import { StatusCircle, type StatusTone } from "@/components/ui/status-circle";

interface AuthShellProps {
  title: string;
  /** Opcional: una pantalla puede explicar todo dentro de la tarjeta (p. ej. el error de un enlace). */
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  /**
   * `split` (por defecto): en escritorio, panel de marca oscuro + formulario sobre papel; en móvil, sólo el formulario con la marca
   * encima (login, crear cuenta, recuperar contraseña). `card`: tarjeta centrada de 440 px (confirmaciones, errores de enlace,
   * contraseña nueva, cuenta no disponible).
   */
  layout?: "split" | "card";
  /** Sólo `card`: círculo de estado en lugar del ícono de la marca. */
  status?: { tone: StatusTone; icon: ComponentType<SVGProps<SVGSVGElement>> };
}

const BRAND_POINTS = [
  { icon: CalendarDaysIcon, text: "Series recurrentes, entrenamientos y clases sueltas sin choques de horario." },
  { icon: UsersIcon, text: "Perfiles, historial de clases y estado de pago, todo en un solo lugar." },
  { icon: BanknotesIcon, text: "Mensualidades, pagos y vencimientos siempre a la vista." },
];

/**
 * Envoltorio visual compartido por las pantallas de autenticación —
 * mismo espíritu que `accountStyles.ts` en móvil ("evita repetir el mismo
 * formulario 5 veces"). Rediseño visual v1: dos mitades en escritorio
 * (docs/design/web-v1/02-componentes-y-navegacion.md §10) y tarjeta centrada para los estados.
 */
export function AuthShell({ title, subtitle, children, footer, layout = "split", status }: AuthShellProps) {
  if (layout === "card") {
    return (
      <main id="contenido" tabIndex={-1} className="focus:outline-none flex min-h-screen flex-col items-center justify-center px-5 py-8">
        <div className="w-full max-w-[440px]">
          <div className="mb-6 flex flex-col items-center gap-3 text-center">
            {status ? <StatusCircle tone={status.tone} icon={status.icon} /> : <Image src="/icon.png" alt="TeacherFlow" width={60} height={60} className="rounded-2xl" />}
            <h1 className="font-display text-[30px] font-medium leading-[1.15] tracking-[-0.02em] text-textPrimary">{title}</h1>
            {subtitle && <p className="max-w-[380px] text-[15px] text-textSecondary">{subtitle}</p>}
          </div>

          <div className="flex flex-col gap-4 rounded-lg border-[1.5px] border-border bg-surface p-5 shadow-card nav:p-6">{children}</div>

          {footer}

          <TextLink href="/" block className="mt-2">
            Volver al inicio
          </TextLink>
        </div>
      </main>
    );
  }

  return (
    <div className="grid min-h-screen grid-cols-1 nav:grid-cols-2">
      <aside data-surface="dark" aria-label="TeacherFlow" className="hidden flex-col justify-between bg-side px-14 py-12 text-background nav:flex">
        <Link href="/" className="inline-flex min-h-11 w-fit items-center rounded-md">
          <BrandMark size="lg" />
        </Link>
        <div>
          <p className="max-w-[460px] font-display text-[44px] font-normal leading-[1.1] tracking-[-0.025em]">
            Todo tu trabajo docente, <em className="text-[#F2B28F]">ordenado.</em>
          </p>
          <p className="mt-3.5 max-w-[420px] text-sideText">
            TeacherFlow reúne alumnos, calendario y cobros de tus clases particulares en una sola herramienta simple, pensada para profesoras y profesores independientes.
          </p>
        </div>
        <ul className="flex max-w-[420px] flex-col gap-2.5">
          {BRAND_POINTS.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-3 rounded-2xl border border-sideLine bg-side2 px-3.5 py-3 text-[14.5px]">
              <Icon className="h-5 w-5 shrink-0 text-[#F2B28F]" aria-hidden />
              {text}
            </li>
          ))}
        </ul>
      </aside>

      <main id="contenido" tabIndex={-1} className="focus:outline-none flex items-start justify-center px-[18px] py-7 nav:items-center nav:px-8 nav:py-10">
        <div className="flex w-full max-w-[420px] flex-col gap-5">
          <Link href="/" aria-label="TeacherFlow, volver al inicio" className="inline-flex min-h-11 w-fit items-center rounded-md nav:hidden">
            <BrandMark size="sm" />
          </Link>
          <div>
            <h1 className="font-display text-[30px] font-medium leading-[1.1] tracking-[-0.025em] text-textPrimary nav:text-[34px]">{title}</h1>
            {subtitle && <p className="mt-1.5 text-textMuted">{subtitle}</p>}
          </div>

          {children}

          {footer}

          <TextLink href="/" block>
            Volver al inicio
          </TextLink>
        </div>
      </main>
    </div>
  );
}
