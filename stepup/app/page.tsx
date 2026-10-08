import { AcademicCapIcon, ArrowRightIcon, BanknotesIcon, CalendarDaysIcon, UsersIcon } from "@heroicons/react/24/outline";
import { Badge } from "@/components/ui/badge";
import { BrandMark } from "@/components/ui/brand";
import { ButtonLink } from "@/components/auth/public-links";

const FEATURES = [
  {
    title: "Alumnos",
    description: "Perfiles, historial de clases y estado de pago, todo en un solo lugar.",
    icon: UsersIcon,
    tile: "tf-av-3",
  },
  {
    title: "Calendario",
    description: "Series recurrentes, entrenamientos y clases sueltas sin choques de horario.",
    icon: CalendarDaysIcon,
    tile: "bg-accentSoft text-accentText",
  },
  {
    title: "Cobros",
    description: "Mensualidades, pagos y vencimientos siempre a la vista.",
    icon: BanknotesIcon,
    tile: "bg-okSoft text-ok",
  },
];

// Ilustración decorativa del héroe: una agenda de ejemplo, sin datos reales ni nombres de personas.
const PREVIEW_ROWS = [
  { time: "09:00", label: "Clase individual", tone: "tf-av-0", live: true },
  { time: "10:30", label: "Clase grupal", tone: "tf-av-3", live: false },
  { time: "12:00", label: "Entrenamiento", tone: "tf-av-2", live: false },
  { time: "16:00", label: "Clase individual", tone: "tf-av-5", live: false },
];

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-[1240px] items-center justify-between px-[18px] py-3.5 nav:px-10 nav:py-[18px]">
        <BrandMark size="md" />
        <ButtonLink href="/login">Iniciar sesión</ButtonLink>
      </header>

      <main id="contenido" tabIndex={-1} className="focus:outline-none flex-1">
        <section className="mx-auto grid w-full max-w-[1240px] grid-cols-1 items-center gap-7 px-[18px] pb-2 pt-7 nav:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] nav:gap-12 nav:px-10 nav:pb-6 nav:pt-14">
          <div>
            <Badge tone="accent" icon={<AcademicCapIcon className="h-4 w-4" aria-hidden />}>
              Para profesoras y profesores independientes
            </Badge>
            <h1 className="mt-[18px] font-display text-[42px] font-normal leading-[1.03] tracking-[-0.035em] text-textPrimary max-[360px]:text-4xl nav:text-hero">
              Todo tu trabajo docente, <em className="text-accentDark">ordenado.</em>
            </h1>
            <p className="mt-5 max-w-[520px] text-[17px] text-textSecondary nav:text-[19px]">
              TeacherFlow reúne alumnos, calendario y cobros de tus clases particulares en una sola herramienta simple, pensada para profesoras y profesores independientes.
            </p>
            <div className="mt-7">
              <ButtonLink href="/crear-cuenta" variant="accent" size="lg">
                Empezar
                <ArrowRightIcon className="h-5 w-5" aria-hidden />
              </ButtonLink>
            </div>
          </div>

          <div aria-hidden className="rounded-[24px] bg-side p-[18px] shadow-panel nav:rotate-[1.2deg]">
            <div className="rounded-[14px] bg-background p-4">
              <div className="flex items-center justify-between">
                <b className="font-display text-xl font-semibold">Hoy</b>
                <Badge>Agenda</Badge>
              </div>
              {PREVIEW_ROWS.map((row) => (
                <div key={row.time} className="mt-2.5 flex items-center gap-3 border-t border-border pt-2.5">
                  <b className="w-12 font-display font-semibold tf-num">{row.time}</b>
                  <span className={`h-7 w-7 shrink-0 rounded-pill ${row.tone}`} />
                  <span className="min-w-0 flex-1 font-[650] leading-snug">{row.label}</span>
                  {row.live && (
                    <Badge tone="accent" dot>
                      En curso
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section aria-label="Qué incluye" className="mx-auto grid w-full max-w-[1240px] grid-cols-1 gap-[18px] px-[18px] pb-9 pt-3 nav:grid-cols-3 nav:px-10 nav:pb-14 nav:pt-6">
          {FEATURES.map((feature) => (
            <div
              key={feature.title}
              className="rounded-lg border-[1.5px] border-border bg-surface p-[22px] text-left shadow-card transition-all duration-200 ease-premium hover:-translate-y-0.5 hover:shadow-cardHover"
            >
              <span aria-hidden className={`mb-3.5 flex h-12 w-12 items-center justify-center rounded-[14px] ${feature.tile}`}>
                <feature.icon className="h-6 w-6" />
              </span>
              <h2 className="font-display text-[22px] font-semibold">{feature.title}</h2>
              <p className="mt-1.5 text-textSecondary">{feature.description}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-t-[1.5px] border-border px-5 py-[22px] text-center text-sm text-textMuted nav:px-10">
        TeacherFlow — para profesoras y profesores independientes.
      </footer>
    </div>
  );
}
