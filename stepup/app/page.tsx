import Image from "next/image";
import Link from "next/link";

const FEATURES = [
  {
    title: "Alumnos",
    description: "Perfiles, historial de clases y estado de pago, todo en un solo lugar.",
  },
  {
    title: "Calendario",
    description: "Series recurrentes, entrenamientos y clases sueltas sin choques de horario.",
  },
  {
    title: "Cobros",
    description: "Mensualidades, recargos y vencimientos resueltos automáticamente.",
  },
];

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between px-6 py-5 sm:px-10">
        <div className="flex items-center gap-3">
          <Image src="/icon.png" alt="TeacherFlow" width={36} height={36} className="rounded-md" />
          <span className="text-lg font-bold tracking-tight">TeacherFlow</span>
        </div>
        <Link
          href="/login"
          className="rounded-md bg-brandBlue px-4 py-2 text-sm font-semibold text-white transition hover:bg-brandBlueDark focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue focus-visible:ring-offset-2"
        >
          Iniciar sesión
        </Link>
      </header>

      <section className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center gap-6 px-6 py-16 text-center sm:px-10">
        <h1 className="text-3xl font-extrabold tracking-tight text-textPrimary sm:text-5xl">
          Todo tu trabajo docente, ordenado.
        </h1>
        <p className="max-w-xl text-base text-textSecondary sm:text-lg">
          TeacherFlow reúne alumnos, calendario y cobros de tus clases particulares en una sola
          herramienta simple, pensada para profesoras y profesores independientes.
        </p>
        <Link
          href="/login"
          className="mt-2 rounded-md bg-brandBlue px-6 py-3 text-base font-semibold text-white transition hover:bg-brandBlueDark focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue focus-visible:ring-offset-2"
        >
          Empezar
        </Link>
      </section>

      <section className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-4 px-6 pb-16 sm:grid-cols-3 sm:px-10">
        {FEATURES.map((feature) => (
          <div
            key={feature.title}
            className="rounded-lg border border-border bg-surface p-5 text-left shadow-sm"
          >
            <h2 className="text-base font-bold text-textPrimary">{feature.title}</h2>
            <p className="mt-1 text-sm text-textSecondary">{feature.description}</p>
          </div>
        ))}
      </section>

      <footer className="border-t border-border px-6 py-6 text-center text-xs text-textMuted sm:px-10">
        TeacherFlow — versión web en construcción.
      </footer>
    </main>
  );
}
