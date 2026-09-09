export const metadata = { title: "Configuración · TeacherFlow" };

const SECTIONS = [
  { title: "Perfil de la profesora", description: "Nombre y datos visibles en la app." },
  { title: "Cuenta", description: "Correo, contraseña y sesión activa." },
  { title: "Respaldo", description: "Copias de seguridad de tus datos." },
];

export default function ConfiguracionPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8">
      <h1 className="text-2xl font-bold text-textPrimary">Configuración</h1>
      <p className="mt-1 text-sm text-textMuted">Vista previa — sin conexión a tu cuenta real todavía.</p>

      <ul className="mt-6 flex flex-col gap-2">
        {SECTIONS.map((section) => (
          <li key={section.title} className="rounded-lg border border-border bg-surface px-4 py-3">
            <p className="text-sm font-semibold text-textPrimary">{section.title}</p>
            <p className="text-xs text-textMuted">{section.description}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
