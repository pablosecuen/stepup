export const metadata = { title: "Configuración · TeacherFlow" };

const SECTIONS = [
  { title: "Perfil de la profesora", description: "Nombre y datos visibles en la app." },
  { title: "Cuenta", description: "Correo, contraseña y sesión activa." },
  { title: "Respaldo", description: "Copias de seguridad de tus datos." },
];

export default function ConfiguracionPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8 sm:py-10">
      <h1 className="text-[26px] font-bold leading-tight tracking-tight text-textPrimary">Configuración</h1>
      <p className="mt-1.5 text-sm text-textMuted">Vista previa — sin conexión a tu cuenta real todavía.</p>

      <ul className="mt-7 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {SECTIONS.map((section) => (
          <li
            key={section.title}
            className="rounded-lg border border-border bg-surface px-4 py-3.5 shadow-card transition-all duration-200 ease-premium hover:-translate-y-0.5 hover:border-brandBlue/30 hover:shadow-cardHover"
          >
            <p className="text-sm font-semibold text-textPrimary">{section.title}</p>
            <p className="mt-0.5 text-xs text-textMuted">{section.description}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
