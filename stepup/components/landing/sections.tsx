import type { CSSProperties, ReactNode } from "react";
import {
  ArrowDownIcon,
  ArrowRightIcon,
  CalendarDaysIcon,
  CheckCircleIcon,
  ClipboardDocumentCheckIcon,
  KeyIcon,
  LockClosedIcon,
  ShieldCheckIcon,
  TrashIcon,
  UsersIcon,
} from "@heroicons/react/24/outline";
import { ButtonLink } from "@/components/auth/public-links";
import { CollectedEvolutionChart } from "@/components/finance/collected-evolution-chart";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Parallax } from "@/components/landing/parallax";
import { Reveal } from "@/components/landing/reveal";
import { Tour, type TourItem } from "@/components/landing/tour";
import { FloatAvailability, FloatNextClass, FloatOpenLesson, FloatPaymentReceived, FloatReminder, FloatRegisterPayment, FloatReport, FloatReschedule, FloatSeries, FloatStudent, FloatToRegister } from "@/components/landing/floats";
import { MiniWindow, MockHeader, MockScene, Monitor } from "@/components/landing/frame";
import { BudgetDonut, BudgetLegend, ChargeRows, ScreenAlumnos, ScreenCalendarioDia, ScreenCalendarioSemana, ScreenCobros, ScreenInicio, ScreenPerfil, ScreenResumen, WeekGrid } from "@/components/landing/screens";
import { DEMO_COLLECTED, DEMO_COLLECTED_THIS_MONTH, DEMO_PAYMENTS } from "@/lib/landing/demo-data";
import { formatMoney } from "@/lib/format/number-format";

/** Secciones de la landing pública. Las pantallas y paneles son DEMOSTRATIVOS (datos sintéticos); el texto describe lo que de verdad hace TeacherFlow. */

const WRAP = "mx-auto w-full max-w-[1240px] px-4 nav:px-10";
const H2 = "font-display text-[34px] font-normal leading-[1.06] tracking-[-0.03em] text-balance min-[420px]:text-[40px] nav:text-[50px]";
const EYEBROW = "text-label font-bold uppercase text-accentDark";
const par = (k: number): CSSProperties => ({ "--k": `${k}px` }) as CSSProperties;

function Eyebrow({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return <p className={`text-label font-bold uppercase ${dark ? "text-sideAccent" : "text-accentDark"}`}>{children}</p>;
}

function Check({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return (
    <li className="flex items-start gap-3">
      <CheckCircleIcon className={`mt-0.5 h-5 w-5 shrink-0 ${dark ? "text-sideAccent" : "text-ok"}`} aria-hidden />
      <span>{children}</span>
    </li>
  );
}

// ── 1. Héroe ────────────────────────────────────────────────────────────────────────────────────────────────────────

export function Hero() {
  return (
    <section id="top" aria-labelledby="hero-title" className="relative overflow-hidden pb-14 pt-10 nav:pb-24 nav:pt-16">
      <div className={WRAP}>
        <div className="mx-auto max-w-[900px] nav:text-center">
          <p style={{ animationDelay: "0ms" }} className="motion-safe:animate-tf-rise">
            <Badge tone="accent">Para profesoras y profesores independientes</Badge>
          </p>
          <h1
            id="hero-title"
            style={{ animationDelay: "60ms" }}
            className="mt-5 font-display text-[40px] font-normal leading-[1.03] tracking-[-0.035em] text-balance motion-safe:animate-tf-rise max-[360px]:text-[34px] min-[420px]:text-[48px] nav:text-[68px]"
          >
            Tu agenda, tus alumnos y tus cobros, <em className="text-accentDark">en un solo lugar.</em>
          </h1>
          <p style={{ animationDelay: "120ms" }} className="mt-5 text-[17px] leading-relaxed text-textSecondary motion-safe:animate-tf-rise nav:mx-auto nav:max-w-[700px] nav:text-[20px]">
            TeacherFlow es la plataforma web para profesoras y profesores independientes. Organizá tus clases y series, llevá el seguimiento de cada alumno y controlá qué cobraste y qué vence, sin planillas ni cuadernos.
          </p>
          <div style={{ animationDelay: "180ms" }} className="mt-7 flex flex-col gap-3 motion-safe:animate-tf-rise min-[480px]:flex-row nav:justify-center">
            <ButtonLink href="/crear-cuenta" variant="accent" size="lg">
              Crear cuenta
              <ArrowRightIcon className="h-5 w-5" aria-hidden />
            </ButtonLink>
            <ButtonLink href="/login" variant="secondary" size="lg">
              Iniciar sesión
            </ButtonLink>
          </div>
          <p style={{ animationDelay: "220ms" }} className="mt-4 text-[14px] text-textMuted motion-safe:animate-tf-rise">
            Se usa desde el navegador de tu computadora. Sin instalar nada.
          </p>
        </div>

        <Parallax className="relative mx-auto mt-10 max-w-[1100px] nav:mt-14">
          <MockScene label="Pantalla de Inicio de TeacherFlow en una computadora de escritorio: clases de hoy, próxima clase, clases por registrar, recordatorios y cobros. Alrededor, paneles con una próxima clase, un cobro recibido, una clase por registrar, un recordatorio y el detalle de un alumno. Información ilustrativa.">
            <div style={{ animationDelay: "260ms" }} className="motion-safe:animate-tf-rise">
              <Monitor path="inicio">
                <ScreenInicio />
              </Monitor>
            </div>
            {/* Escritorio: paneles flotantes alrededor de la ventana, con paralaje leve */}
            <div className="hidden lg:block">
              <div className="tf-par absolute left-0 top-[36%] z-10 w-[240px] xl:-left-[88px] 2xl:-left-28" style={par(-30)}>
                <Reveal delay={120}>
                  <FloatNextClass />
                </Reveal>
              </div>
              <div className="tf-par absolute -right-2 top-[2%] z-10 w-[240px] xl:-right-10 2xl:-right-24" style={par(-16)}>
                <Reveal delay={240}>
                  <FloatReminder />
                </Reveal>
              </div>
              <div className="tf-par absolute -right-3 top-[48%] z-10 w-[240px] xl:-right-14 2xl:-right-32" style={par(-40)}>
                <Reveal delay={360}>
                  <FloatPaymentReceived />
                </Reveal>
              </div>
              <div className="tf-par absolute left-0 bottom-[6%] z-10 w-[240px] xl:-left-14 2xl:-left-32" style={par(-22)}>
                <Reveal delay={300}>
                  <FloatToRegister />
                </Reveal>
              </div>
              <div className="tf-par absolute bottom-[-4%] right-[20%] z-10 w-[250px]" style={par(-12)}>
                <Reveal delay={420}>
                  <FloatStudent />
                </Reveal>
              </div>
            </div>
            {/* Móvil y tablet: los paneles pasan debajo de la ventana, apilados */}
            <div className="mt-4 grid gap-3 min-[560px]:grid-cols-2 lg:hidden">
              <Reveal>
                <FloatNextClass />
              </Reveal>
              <Reveal delay={80}>
                <FloatPaymentReceived />
              </Reveal>
              <Reveal className="min-[560px]:col-span-2">
                <FloatToRegister />
              </Reveal>
            </div>
          </MockScene>
        </Parallax>
        <p className="mt-6 text-center text-[13px] text-textMuted lg:mt-10">Pantallas con información ilustrativa.</p>
      </div>
    </section>
  );
}

// ── 2. Todo tu trabajo en un solo lugar ─────────────────────────────────────────────────────────────────────────────

const PRODUCT_INDEX = [
  { n: "01", title: "Alumnos", text: "Perfil, nivel, historial y seguimiento de cada uno.", href: "#alumnos" },
  { n: "02", title: "Calendario", text: "Vista semanal y diaria, con la escala de color por modalidad.", href: "#calendario" },
  { n: "03", title: "Clases y series", text: "Clases sueltas, grupales y series que se repiten.", href: "#agenda" },
  { n: "04", title: "Registro de clases", text: "Dejá asentado qué se dictó y qué quedó pendiente.", href: "#como-funciona" },
  { n: "05", title: "Cobros y vencimientos", text: "Mensualidades, pagos y vencimientos siempre a la vista.", href: "#cobros-resumen" },
  { n: "06", title: "Recordatorios", text: "Lo que se acerca o quedó sin resolver, en un solo aviso.", href: "#recorrido" },
  { n: "07", title: "Resumen financiero", text: "Evolución de lo cobrado y una distribución sugerida.", href: "#cobros" },
] as const;

export function ProductIndex() {
  return (
    <section id="producto" aria-labelledby="producto-title" className="tf-cv scroll-mt-20 border-y border-border bg-surface py-14 nav:py-24">
      <div className={`${WRAP} grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16`}>
        <Reveal>
          <Eyebrow>Todo en un solo lugar</Eyebrow>
          <h2 id="producto-title" className={`mt-3 ${H2}`}>
            Todo tu trabajo docente, <em className="text-accentDark">a la vista.</em>
          </h2>
          <p className="mt-4 max-w-[480px] text-[17px] leading-relaxed text-textSecondary">
            Dejás de repartir la información entre cuadernos, mensajes y planillas: cada parte del trabajo tiene su lugar y se conecta con las demás.
          </p>
        </Reveal>
        <ol className="divide-y divide-border border-y border-border">
          {PRODUCT_INDEX.map((item, index) => (
            <Reveal as="li" key={item.n} delay={index * 40}>
              <a href={item.href} className="group grid min-h-[64px] grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-x-3 py-3.5 transition-colors duration-200 hover:bg-background focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink motion-reduce:transition-none nav:grid-cols-[3rem_minmax(0,1fr)_auto] nav:px-2">
                <span className="font-display text-[15px] font-medium text-accentDark tf-num">{item.n}</span>
                <span className="min-w-0">
                  <span className="block font-display text-[21px] font-semibold leading-tight tracking-tight nav:text-[24px]">{item.title}</span>
                  <span className="mt-0.5 block text-[14.5px] text-textSecondary">{item.text}</span>
                </span>
                <ArrowDownIcon className="h-5 w-5 text-textMuted transition-transform duration-200 group-hover:translate-y-0.5 motion-reduce:transition-none" aria-hidden />
              </a>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}

/** Escena A — Agenda, series y disponibilidad: texto angosto a la izquierda; la ventana se extiende hasta el borde derecho. */
export function SceneAgenda() {
  return (
    <section id="agenda" aria-labelledby="agenda-title" className="tf-cv relative scroll-mt-20 overflow-hidden py-16 nav:py-28">
      <div className={`${WRAP} grid items-center gap-10 lg:grid-cols-[360px_minmax(0,1fr)] lg:gap-14`}>
        <Reveal>
          <Eyebrow>Agenda, series y disponibilidad</Eyebrow>
          <h2 id="agenda-title" className={`mt-3 ${H2}`}>
            Tu semana completa, <em className="text-accentDark">sin choques de horario.</em>
          </h2>
          <p className="mt-4 text-[17px] leading-relaxed text-textSecondary">
            Cargá clases sueltas, grupales o series que se repiten, y mirá todo en un calendario donde cada modalidad tiene su color.
          </p>
          <ul className="mt-5 space-y-3 text-[16px] text-textSecondary">
            <Check>Series semanales: definís los días una sola vez.</Check>
            <Check>Bloqueos de disponibilidad: almuerzos, vacaciones y feriados.</Check>
            <Check>Aviso de conflicto al crear o reprogramar una clase.</Check>
          </ul>
          <a href="#calendario" className="mt-5 inline-flex min-h-11 items-center gap-1.5 text-[15px] font-[650] text-accentDark underline-offset-[3px] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ink">
            Ver el Calendario en detalle <ArrowDownIcon className="h-4 w-4" aria-hidden />
          </a>
        </Reveal>

        <MockScene label="Calendario semanal de TeacherFlow con clases coloreadas por modalidad, una clase cancelada y su reemplazo. Sobre la ventana, un panel de serie semanal los lunes y jueves y otro de disponibilidad con bloqueos y vacaciones. Información ilustrativa." className="relative min-w-0 lg:-mr-[max(0px,calc((100vw-1240px)/2+40px))]">
          <Reveal delay={80}>
            <MiniWindow path="calendario" className="lg:rounded-r-none lg:border-r-0">
              <ScreenCalendarioSemana />
            </MiniWindow>
          </Reveal>
          <div className="mt-4 grid gap-3 min-[560px]:grid-cols-2 lg:hidden">
            <FloatSeries />
            <FloatAvailability />
          </div>
          <div className="hidden lg:block">
            <Reveal delay={220} className="absolute -left-12 bottom-10 z-10 w-[270px]">
              <FloatSeries />
            </Reveal>
            <Reveal delay={320} className="absolute -bottom-8 right-12 z-10 w-[290px]">
              <FloatAvailability />
            </Reveal>
          </div>
        </MockScene>
      </div>
    </section>
  );
}

/** Escena B — Alumnos: fondo oscuro, composición invertida (ventana a la izquierda). */
export function SceneStudents() {
  return (
    <section id="alumnos-resumen" aria-labelledby="alumnos-resumen-title" className="tf-cv relative scroll-mt-20 overflow-hidden bg-side py-16 text-white nav:py-28">
      <div className={`${WRAP} grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-16`}>
        <MockScene label="Lista de alumnos de TeacherFlow con nivel, modalidad, próxima clase y estado de pago de cada uno. Sobre la ventana, el detalle de una alumna y un reporte en PDF. Información ilustrativa." className="relative order-2 min-w-0 lg:order-1 lg:-ml-[max(0px,calc((100vw-1240px)/2+40px))]">
          <Reveal>
            <MiniWindow path="alumnos" className="lg:rounded-l-none lg:border-l-0">
              <ScreenAlumnos />
            </MiniWindow>
          </Reveal>
          <div className="mt-4 grid gap-3 min-[560px]:grid-cols-2 lg:hidden">
            <FloatStudent />
            <FloatReport />
          </div>
          <div className="hidden lg:block">
            <Reveal delay={200} className="absolute -right-10 top-12 z-10 w-[270px]">
              <FloatStudent />
            </Reveal>
            <Reveal delay={320} className="absolute -bottom-8 right-[44%] z-10 w-[260px]">
              <FloatReport />
            </Reveal>
          </div>
        </MockScene>

        <Reveal className="order-1 lg:order-2">
          <Eyebrow dark>Alumnos, historial y seguimiento</Eyebrow>
          <h2 id="alumnos-resumen-title" className={`mt-3 ${H2}`}>
            Cada alumno, <em className="text-sideAccent">con su historia.</em>
          </h2>
          <p className="mt-4 text-[17px] leading-relaxed text-sideText">
            Nivel, modalidad, clases dadas, tareas, cobros y reportes viven en el perfil de cada persona. Abrís un alumno y tenés todo lo que necesitás para la próxima clase.
          </p>
          <ul className="mt-5 space-y-3 text-[16px] text-sideText">
            <Check dark>Perfil con siete secciones, de Resumen a Información.</Check>
            <Check dark>Historial de clases y progreso.</Check>
            <Check dark>Reportes en PDF para compartir.</Check>
          </ul>
          <a href="#alumnos" className="mt-5 inline-flex min-h-11 items-center gap-1.5 text-[15px] font-[650] text-sideAccent underline-offset-[3px] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-sideAccent">
            Ver el perfil en detalle <ArrowDownIcon className="h-4 w-4" aria-hidden />
          </a>
        </Reveal>
      </div>
    </section>
  );
}

/** Escena C — Cobros: título centrado y una computadora ancha con paneles a los lados. */
export function SceneCollections() {
  return (
    <section id="cobros-resumen" aria-labelledby="cobros-resumen-title" className="tf-cv relative scroll-mt-20 overflow-hidden bg-paperDeep py-16 nav:py-28">
      <div className={WRAP}>
        <Reveal className="mx-auto max-w-[760px] text-center">
          <Eyebrow>Cobros, vencimientos y resumen financiero</Eyebrow>
          <h2 id="cobros-resumen-title" className={`mt-3 ${H2}`}>
            Sabés quién pagó, <em className="text-accentDark">quién debe y qué vence.</em>
          </h2>
          <p className="mt-4 text-[17px] leading-relaxed text-textSecondary">
            Mensualidades, pagos y vencimientos siempre a la vista. Registrás cada pago y ves en un momento cuánto cobraste y cuánto falta.
          </p>
        </Reveal>

        <MockScene label="Pantalla de Cobros de TeacherFlow con importes pendientes, vencimientos, estado de cada cobro y pagos registrados. Alrededor, un panel para registrar un pago y otro con un cobro recibido. Información ilustrativa." className="relative mx-auto mt-10 max-w-[1000px] nav:mt-14">
          <Reveal>
            <Monitor path="cobros">
              <ScreenCobros />
            </Monitor>
          </Reveal>
          <div className="mt-4 grid gap-3 min-[560px]:grid-cols-2 lg:hidden">
            <FloatRegisterPayment />
            <FloatPaymentReceived />
          </div>
          <div className="hidden lg:block">
            <Reveal delay={200} className="absolute -left-14 top-[26%] z-10 w-[280px]">
              <FloatRegisterPayment />
            </Reveal>
            <Reveal delay={320} className="absolute -right-14 bottom-[14%] z-10 w-[250px]">
              <FloatPaymentReceived />
            </Reveal>
          </div>
        </MockScene>
        <p className="mt-8 text-center text-[13px] text-textMuted lg:mt-12">TeacherFlow organiza y registra tus cobros: no procesa pagos.</p>
      </div>
    </section>
  );
}

// ── 3. Recorrido interactivo ────────────────────────────────────────────────────────────────────────────────────────

const TOUR_ITEMS: readonly TourItem[] = [
  { key: "inicio", label: "Inicio", title: "Inicio: el día de un vistazo", text: "Tu próxima clase, todas las clases de hoy en una línea de tiempo, lo que falta registrar, tus recordatorios y los cobros que vencen.", alt: "Pantalla de Inicio de TeacherFlow con la próxima clase, la línea de tiempo del día, clases por registrar y cobros de hoy. Información ilustrativa." },
  { key: "calendario", label: "Calendario", title: "Calendario: la semana y el día", text: "Cambiás entre vista semanal y diaria. Cada modalidad tiene su color y las clases canceladas, reprogramadas o con reemplazo se distinguen con texto.", alt: "Pantalla del Calendario semanal de TeacherFlow con clases por modalidad. Información ilustrativa." },
  { key: "perfil", label: "Perfil del alumno", title: "Perfil del alumno: todo en un solo lugar", text: "Resumen, clases, progreso, tareas, cobros, reportes e información de cada alumno, a un clic de distancia.", alt: "Perfil de una alumna en TeacherFlow con sus cifras, próxima clase y última clase. Información ilustrativa." },
  { key: "cobros", label: "Cobros", title: "Cobros: pendientes y vencimientos", text: "Quién debe, cuánto, y cuándo vence. Registrás el pago desde la misma lista.", alt: "Pantalla de Cobros de TeacherFlow con pendientes, vencimientos y pagos registrados. Información ilustrativa." },
  { key: "resumen", label: "Resumen financiero", title: "Resumen financiero: lo cobrado, mes a mes", text: "Evolución de cobros con barras verdes y una distribución sugerida 50/30/20 calculada sobre lo que cobraste.", alt: "Resumen financiero de TeacherFlow con la evolución de cobros y la distribución sugerida. Información ilustrativa." },
];

export function TourSection() {
  return (
    <section id="recorrido" aria-labelledby="recorrido-title" className="tf-cv scroll-mt-20 py-16 nav:py-28">
      <div className={WRAP}>
        <Reveal className="mx-auto max-w-[720px] text-center">
          <Eyebrow>Recorrido</Eyebrow>
          <h2 id="recorrido-title" className={`mt-3 ${H2}`}>
            Elegí una pantalla y <em className="text-accentDark">recorrela.</em>
          </h2>
          <p className="mt-4 text-[17px] leading-relaxed text-textSecondary">Cinco pantallas de TeacherFlow, con información ilustrativa. Vos decidís cuál mirar.</p>
        </Reveal>
        <Reveal delay={80} className="mt-10 rounded-[28px] bg-side p-4 nav:mt-14 nav:p-10">
          <Tour items={TOUR_ITEMS} />
        </Reveal>
      </div>
    </section>
  );
}

// ── 4. Calendario en detalle ────────────────────────────────────────────────────────────────────────────────────────

const CAL_FEATURES = [
  { Icon: CalendarDaysIcon, title: "Vista semanal", text: "La semana completa, con la hora actual marcada y un color por modalidad." },
  { Icon: ClipboardDocumentCheckIcon, title: "Vista diaria", text: "El día en orden, con el estado de cada clase: pasada, en curso, sigue o cancelada." },
  { Icon: CheckCircleIcon, title: "Clase abierta", text: "Tocás una clase y ves su detalle: registrarla, reprogramarla o cancelarla." },
  { Icon: ArrowRightIcon, title: "Reprogramación", text: "Elegís el nuevo horario y te avisamos si choca con otra clase o un bloqueo." },
  { Icon: UsersIcon, title: "Series", text: "Definís los días de la semana una vez y cada clase queda en el calendario." },
  { Icon: LockClosedIcon, title: "Disponibilidad", text: "Bloqueos semanales y excepciones, como vacaciones o feriados." },
] as const;

export function CalendarDetail() {
  return (
    <section id="calendario" aria-labelledby="calendario-title" className="tf-cv relative scroll-mt-20 overflow-hidden border-t border-border bg-surface py-16 nav:py-28">
      <div className={WRAP}>
        <Reveal className="max-w-[720px]">
          <Eyebrow>Calendario</Eyebrow>
          <h2 id="calendario-title" className={`mt-3 ${H2}`}>
            Del panorama de la semana <em className="text-accentDark">al detalle de cada clase.</em>
          </h2>
        </Reveal>

        <MockScene label="Dos ventanas del Calendario de TeacherFlow: la vista semanal con una clase resaltada y la vista diaria. Encima, la clase abierta con sus acciones y el panel para reprogramarla. Información ilustrativa." className="relative mt-10 grid gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] nav:mt-14">
          <Reveal>
            <MiniWindow path="calendario?vista=semana">
              <div className="tf-mk bg-background px-3.5 pb-4 pt-3.5">
                <MockHeader title="Semana del 12 al 16 de octubre" />
                <div className="mt-3">
                  <WeekGrid highlight={{ day: 3, start: 10 }} />
                </div>
              </div>
            </MiniWindow>
          </Reveal>
          <div className="relative min-w-0 lg:pt-16">
            <Reveal delay={120}>
              <MiniWindow path="calendario?vista=dia">
                <ScreenCalendarioDia limit={4} />
              </MiniWindow>
            </Reveal>
            <div className="relative z-10 mt-4 grid gap-3 min-[560px]:grid-cols-2 xl:-ml-28 xl:-mt-10 xl:w-[calc(100%+7rem)]">
              <Reveal delay={240}>
                <FloatOpenLesson />
              </Reveal>
              <Reveal delay={360} className="xl:mt-14">
                <FloatReschedule />
              </Reveal>
            </div>
          </div>
        </MockScene>

        <dl className="mt-16 grid gap-x-10 gap-y-7 min-[640px]:grid-cols-2 lg:mt-24 lg:grid-cols-3">
          {CAL_FEATURES.map(({ Icon, title, text }, index) => (
            <Reveal key={title} delay={(index % 3) * 60} className="border-t-[1.5px] border-ink pt-4">
              <dt className="flex items-center gap-2 font-display text-[20px] font-semibold tracking-tight">
                <Icon className="h-5 w-5 text-accentDark" aria-hidden />
                {title}
              </dt>
              <dd className="mt-1.5 text-[15.5px] leading-relaxed text-textSecondary">{text}</dd>
            </Reveal>
          ))}
        </dl>
      </div>
    </section>
  );
}

// ── 5. Alumnos en detalle ───────────────────────────────────────────────────────────────────────────────────────────

export function StudentsDetail() {
  const windows: { tab: "Resumen" | "Clases" | "Cobros" | "Reportes"; caption: string; offset: string }[] = [
    { tab: "Resumen", caption: "Resumen", offset: "" },
    { tab: "Clases", caption: "Historial de clases", offset: "lg:mt-14" },
    { tab: "Cobros", caption: "Cobros del alumno", offset: "" },
    { tab: "Reportes", caption: "Reportes y seguimiento", offset: "lg:mt-14" },
  ];
  return (
    <section id="alumnos" aria-labelledby="alumnos-title" className="tf-cv relative scroll-mt-20 overflow-hidden py-16 nav:py-28">
      <div className={`${WRAP} grid gap-12 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:gap-16`}>
        <Reveal className="lg:sticky lg:top-28 lg:self-start">
          <Eyebrow>Alumnos</Eyebrow>
          <h2 id="alumnos-title" className={`mt-3 ${H2}`}>
            Un perfil, <em className="text-accentDark">todo organizado.</em>
          </h2>
          <p className="mt-4 text-[17px] leading-relaxed text-textSecondary">
            La información de cada alumno está en un solo lugar y se recorre por secciones: no hay que buscar en cuadernos, chats ni planillas distintas.
          </p>
          <ul className="mt-5 space-y-3 text-[16px] text-textSecondary">
            <Check>Lista de alumnos con búsqueda y estado de pago.</Check>
            <Check>Perfil con historial de clases, progreso y tareas.</Check>
            <Check>Cobros del alumno y pagos registrados.</Check>
            <Check>Reportes en PDF del período que elijas.</Check>
          </ul>
        </Reveal>

        <MockScene label="Cuatro secciones del perfil de una alumna en TeacherFlow: Resumen, Historial de clases, Cobros y Reportes. Información ilustrativa." className="grid min-w-0 gap-6 min-[720px]:grid-cols-2">
          {windows.map((item, index) => (
            <Reveal key={item.tab} delay={index * 70} className={item.offset}>
              <p className="mb-2 flex items-center gap-2 text-[13px] font-[650] text-textSecondary">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink text-[12px] text-background tf-num">{index + 1}</span>
                {item.caption}
              </p>
              <div className="relative">
                <MiniWindow path={`alumnos/perfil?tab=${item.tab.toLowerCase()}`}>
                  <ScreenPerfil tab={item.tab} framed={false} />
                </MiniWindow>
                {item.tab === "Reportes" && <FloatReport className="relative z-10 -mt-6 ml-auto w-[88%] min-[720px]:absolute min-[720px]:-bottom-8 min-[720px]:right-[-6%] min-[720px]:mt-0 min-[720px]:w-[78%]" />}
              </div>
            </Reveal>
          ))}
        </MockScene>
      </div>
    </section>
  );
}

// ── 6. Cobros y resumen financiero (con el gráfico real) ────────────────────────────────────────────────────────────

export function FinanceDetail() {
  return (
    <section id="cobros" aria-labelledby="cobros-title" className="tf-cv relative scroll-mt-20 overflow-hidden border-y border-border bg-surface py-16 nav:py-28">
      <div className={WRAP}>
        <div className="grid items-end gap-6 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:gap-16">
          <Reveal>
            <Eyebrow>Cobros y resumen financiero</Eyebrow>
            <h2 id="cobros-title" className={`mt-3 ${H2}`}>
              Lo que cobrás, <em className="text-accentDark">mes a mes.</em>
            </h2>
          </Reveal>
          <Reveal delay={80}>
            <p className="text-[17px] leading-relaxed text-textSecondary">
              Pendientes, vencimientos y pagos registrados en una lista; la evolución de lo cobrado, en barras verdes; y una distribución sugerida para ayudarte a pensar tu mes.
            </p>
          </Reveal>
        </div>

        <Reveal delay={60} className="mt-10 nav:mt-14">
          <MiniWindow path="resumen-financiero">
            <div className="tf-mk bg-background px-4 pb-6 pt-4 nav:px-7 nav:pt-6">
              <MockHeader title="Resumen financiero" sub="Octubre 2026 · información ilustrativa" />
              <div className="mt-5 grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
                <section aria-labelledby="demo-evolucion" className="min-w-0 rounded-[14px] border-[1.5px] border-border bg-surface p-4 shadow-subtle nav:p-5">
                  <h3 id="demo-evolucion" className="font-display text-[19px] font-semibold tracking-tight">
                    Evolución de cobros
                  </h3>
                  <div className="mt-2">
                    <CollectedEvolutionChart series={DEMO_COLLECTED} caption="Últimos 6 meses" />
                  </div>
                </section>
                <section aria-labelledby="demo-distribucion" className="min-w-0 rounded-[14px] border-[1.5px] border-border bg-surface p-4 shadow-subtle nav:p-5">
                  <h3 id="demo-distribucion" className="font-display text-[19px] font-semibold tracking-tight">
                    Distribución sugerida
                  </h3>
                  <p className="text-[13px] text-textMuted">Proyección orientativa sobre lo cobrado en octubre</p>
                  <div className="mt-4 flex flex-wrap items-center gap-5">
                    <BudgetDonut total={DEMO_COLLECTED_THIS_MONTH} size={150} />
                    <BudgetLegend total={DEMO_COLLECTED_THIS_MONTH} />
                  </div>
                  <p className="mt-4 rounded-md border-[1.5px] border-border bg-surface2 px-3 py-2.5 text-[13px] leading-snug text-textSecondary">
                    Es una proyección sobre lo que cobraste (50 % necesidades, 30 % gustos, 20 % ahorro). TeacherFlow no conoce tus gastos ni tu ahorro real.
                  </p>
                </section>
              </div>
              <div className="mt-5 grid min-w-0 gap-5 lg:grid-cols-2">
                <div className="min-w-0">
                  <h3 className="mb-2 font-display text-[19px] font-semibold tracking-tight">Pendientes y vencimientos</h3>
                  <ChargeRows limit={4} />
                </div>
                <div>
                  <h3 className="mb-2 font-display text-[19px] font-semibold tracking-tight">Pagos registrados</h3>
                  <ul className="overflow-hidden rounded-[12px] border-[1.5px] border-border bg-surface shadow-subtle">
                    {DEMO_PAYMENTS.map((payment) => (
                      <li key={payment.student} className="flex items-center gap-3 border-b border-border px-3.5 py-3 last:border-b-0">
                        <Avatar initial={payment.student[0]} tone={payment.tone} size="m" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13.5px] font-bold leading-tight">{payment.student}</span>
                          <span className="block text-[12px] text-textMuted">
                            {payment.concept} · <span className="tf-num">{payment.date}</span>
                          </span>
                        </span>
                        <span className="text-[13.5px] font-bold text-ok tf-num">{formatMoney(payment.amount)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </MiniWindow>
        </Reveal>
      </div>
    </section>
  );
}

// ── 7. Cómo funciona ────────────────────────────────────────────────────────────────────────────────────────────────

function StepArt({ step }: { step: 1 | 2 | 3 | 4 }) {
  const box = "rounded-[14px] border-[1.5px] border-border bg-surface p-3.5 shadow-card";
  if (step === 1) {
    return (
      <div className={`${box} space-y-2`}>
        {[
          ["Lucía F.", 0],
          ["Mateo S.", 3],
          ["Sofía I.", 2],
        ].map(([name, tone]) => (
          <p key={name as string} className="flex items-center gap-2.5 text-[13.5px] font-bold">
            <Avatar initial={(name as string)[0]} tone={tone as number} size="s" />
            {name}
            <span className="ml-auto text-[12px] font-medium text-textMuted">Activo</span>
          </p>
        ))}
      </div>
    );
  }
  if (step === 2) {
    return (
      <div className={`${box}`}>
        <div className="grid grid-cols-5 gap-1.5 text-center text-[11.5px] font-[650] text-textMuted">
          {["L", "M", "X", "J", "V"].map((day, index) => (
            <span key={day}>
              {day}
              <span className={`mt-1 block h-9 rounded-[6px] ${index % 2 === 0 ? "bg-[#DDEEFF]" : "bg-[#FCE4D2]"}`} />
              <span className={`mt-1 block h-6 rounded-[6px] ${index === 1 || index === 3 ? "bg-[#E9DDFC]" : "bg-transparent"}`} />
            </span>
          ))}
        </div>
      </div>
    );
  }
  if (step === 3) {
    return (
      <div className={`${box} space-y-2 text-[13.5px]`}>
        {["Clase dictada", "Tema de la clase", "Tarea para la próxima"].map((item) => (
          <p key={item} className="flex items-center gap-2 font-[650]">
            <CheckCircleIcon className="h-5 w-5 text-ok" aria-hidden />
            {item}
          </p>
        ))}
      </div>
    );
  }
  return (
    <div className={`${box} space-y-2`}>
      <p className="flex items-center justify-between text-[13.5px] font-bold">
        Mateo S. <Badge tone="warn">Vence hoy</Badge>
      </p>
      <p className="flex items-center justify-between text-[13.5px] font-bold">
        Joaquín P. <Badge tone="bad">Vencido</Badge>
      </p>
      <p className="flex items-center justify-between text-[13.5px] font-bold">
        Valentina R. <Badge tone="ok">Pagado</Badge>
      </p>
    </div>
  );
}

const STEPS = [
  { n: 1, title: "Agregá tus alumnos", text: "Nombre, nivel y modalidad. Lo demás se suma con el tiempo." },
  { n: 2, title: "Organizá clases y series", text: "Cargá tus horarios una vez y mirá toda la semana." },
  { n: 3, title: "Registrá cada clase", text: "Dejá asentado qué se dictó y qué tarea quedó." },
  { n: 4, title: "Controlá cobros y pendientes", text: "Mirá quién pagó, quién debe y qué vence." },
] as const;

export function HowItWorks() {
  return (
    <section id="como-funciona" aria-labelledby="como-title" className="tf-cv scroll-mt-20 py-16 nav:py-28">
      <div className={WRAP}>
        <Reveal className="max-w-[640px]">
          <Eyebrow>Cómo funciona</Eyebrow>
          <h2 id="como-title" className={`mt-3 ${H2}`}>
            Cuatro pasos, <em className="text-accentDark">sin vueltas.</em>
          </h2>
        </Reveal>
        <ol className="relative mt-12 grid gap-9 lg:grid-cols-4 lg:gap-6">
          <span aria-hidden className="absolute bottom-6 left-[19px] top-6 w-px bg-borderMid lg:hidden" />
          {STEPS.map((step, index) => (
            <Reveal as="li" key={step.n} delay={index * 80} className="relative pl-14 lg:pl-0">
              <div className={index % 2 === 1 ? "lg:mt-12" : ""}>
                <span className="absolute left-0 top-0 flex h-10 w-10 items-center justify-center rounded-full bg-ink font-display text-[18px] font-semibold text-background tf-num lg:static">{step.n}</span>
                <h3 className="font-display text-[22px] font-semibold leading-tight tracking-tight lg:mt-4">{step.title}</h3>
                <p className="mt-1.5 text-[15.5px] leading-relaxed text-textSecondary">{step.text}</p>
                <div className="mt-4 max-w-[320px]" aria-hidden>
                  <StepArt step={step.n} />
                </div>
              </div>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}

// ── 8. Seguridad y control ──────────────────────────────────────────────────────────────────────────────────────────

const SECURITY = [
  { Icon: ShieldCheckIcon, title: "Tus datos son tuyos", text: "Cada cuenta accede solamente a sus propios datos." },
  { Icon: KeyIcon, title: "Recuperación de contraseña", text: "Si la olvidás, la recuperás con tu correo." },
  { Icon: TrashIcon, title: "Eliminación de cuenta y datos", text: "Podés eliminar tu cuenta y tus datos cuando quieras." },
  { Icon: LockClosedIcon, title: "Sesión protegida", text: "Las pantallas de tu cuenta sólo se abren con tu sesión iniciada." },
] as const;

export function Security() {
  return (
    <section id="seguridad" aria-labelledby="seguridad-title" className="tf-cv scroll-mt-20 overflow-hidden border-t border-border bg-paperDeep py-16 nav:py-28">
      <div className={`${WRAP} grid items-center gap-12 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:gap-16`}>
        <div>
          <Reveal>
            <Eyebrow>Seguridad y control</Eyebrow>
            <h2 id="seguridad-title" className={`mt-3 ${H2}`}>
              Tus datos, <em className="text-accentDark">bajo tu control.</em>
            </h2>
          </Reveal>
          <ul className="mt-8 grid gap-6 min-[640px]:grid-cols-2">
            {SECURITY.map(({ Icon, title, text }, index) => (
              <Reveal as="li" key={title} delay={index * 60}>
                <span aria-hidden className="flex h-11 w-11 items-center justify-center rounded-[12px] bg-surface text-accentDark shadow-card">
                  <Icon className="h-6 w-6" />
                </span>
                <h3 className="mt-3 font-display text-[20px] font-semibold leading-tight tracking-tight">{title}</h3>
                <p className="mt-1 text-[15.5px] leading-relaxed text-textSecondary">{text}</p>
              </Reveal>
            ))}
          </ul>
        </div>
        <Reveal delay={100}>
          <MockScene label="Pantalla de Configuración de TeacherFlow con las acciones Cambiar contraseña y Eliminar cuenta y datos. Ejemplo." className="relative">
            <MiniWindow path="configuracion">
              <div className="tf-mk bg-background px-4 pb-5 pt-4">
                <p className="font-display text-[24px] font-medium leading-tight tracking-[-0.02em]">Configuración</p>
                <div className="mt-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border-[1.5px] border-border bg-surface p-3.5">
                    <span>
                      <span className="block text-[14px] font-bold">Contraseña</span>
                      <span className="block text-[12.5px] text-textMuted">Cambiala cuando quieras</span>
                    </span>
                    <span className="inline-flex h-9 items-center rounded-md border-[1.5px] border-borderMid bg-surface px-3.5 text-[12.5px] font-bold">Cambiar contraseña</span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border-[1.5px] border-badLine bg-surface p-3.5">
                    <span>
                      <span className="block text-[14px] font-bold">Eliminar cuenta y datos</span>
                      <span className="block text-[12.5px] text-textMuted">Borra tu cuenta y toda tu información</span>
                    </span>
                    <span className="inline-flex h-9 items-center rounded-md border-[1.5px] border-bad px-3.5 text-[12.5px] font-bold text-bad">Eliminar</span>
                  </div>
                </div>
              </div>
            </MiniWindow>
          </MockScene>
        </Reveal>
      </div>
    </section>
  );
}

// ── 9. Cierre ───────────────────────────────────────────────────────────────────────────────────────────────────────

const FAQ = [
  { q: "¿Para quién es TeacherFlow?", a: "Para profesoras y profesores independientes que dan clases particulares, individuales o grupales, y quieren ordenar alumnos, agenda y cobros." },
  { q: "¿Necesito instalar algo?", a: "No. TeacherFlow se usa desde el navegador: creás tu cuenta e ingresás." },
  { q: "¿Puedo cargar clases que se repiten?", a: "Sí. Podés crear series semanales, además de clases sueltas, grupales y entrenamientos." },
  { q: "¿TeacherFlow cobra o procesa los pagos de mis alumnos?", a: "No. Te ayuda a registrar y controlar tus cobros: qué corresponde, qué venció y qué ya cobraste." },
  { q: "¿Mis datos son privados?", a: "Cada cuenta accede solamente a sus propios datos, y podés eliminar tu cuenta y tus datos cuando quieras." },
] as const;

export function Closing() {
  return (
    <section id="empezar" aria-labelledby="cierre-title" className="tf-cv scroll-mt-20 bg-side py-16 text-white nav:py-28">
      <div className={`${WRAP} grid gap-12 lg:grid-cols-[minmax(0,6fr)_minmax(0,6fr)] lg:gap-20`}>
        <Reveal>
          <h2 id="cierre-title" className="font-display text-[38px] font-normal leading-[1.05] tracking-[-0.035em] text-balance min-[420px]:text-[46px] nav:text-[58px]">
            Ordená tu trabajo docente <em className="text-sideAccent">desde hoy.</em>
          </h2>
          <p className="mt-5 max-w-[520px] text-[17px] leading-relaxed text-sideText">Creá tu cuenta y empezá por cargar a tus alumnos. El resto se arma solo, clase a clase.</p>
          <div className="mt-7 flex flex-col items-start gap-3 min-[480px]:flex-row min-[480px]:items-center">
            <ButtonLink href="/crear-cuenta" variant="accent" size="lg">
              Crear cuenta
              <ArrowRightIcon className="h-5 w-5" aria-hidden />
            </ButtonLink>
            <a href="/login" className="inline-flex min-h-11 items-center px-2 text-[15px] font-[650] text-white underline underline-offset-[4px] hover:text-sideAccent focus:outline-none focus-visible:ring-2 focus-visible:ring-sideAccent">
              Iniciar sesión
            </a>
          </div>
        </Reveal>
        <Reveal delay={100}>
          <h3 className="font-display text-[22px] font-semibold tracking-tight">Preguntas frecuentes</h3>
          <div className="mt-3 divide-y divide-sideLine border-y border-sideLine">
            {FAQ.map((item) => (
              <details key={item.q} className="group">
                <summary className="flex min-h-[56px] cursor-pointer list-none items-center justify-between gap-4 py-3 text-[16px] font-[650] transition-colors duration-200 hover:text-sideAccent focus:outline-none focus-visible:ring-2 focus-visible:ring-sideAccent motion-reduce:transition-none [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <span aria-hidden className="text-[22px] font-normal leading-none text-sideAccent transition-transform duration-200 group-open:rotate-45 motion-reduce:transition-none">
                    +
                  </span>
                </summary>
                <p className="pb-4 pr-8 text-[15.5px] leading-relaxed text-sideText">{item.a}</p>
              </details>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
