// Mismo patrón que móvil (errorBox/infoBox en accountStyles.ts): error e
// información en línea, nunca un toast — siempre justo debajo del campo o
// botón al que corresponden.
export function FormErrorBox({ message }: { message: string }) {
  return (
    <div role="alert" className="rounded-md border border-statusRojo/30 bg-statusRojo/5 px-3 py-2.5 text-sm text-statusRojo">
      {message}
    </div>
  );
}

export function FormInfoBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-background px-3 py-2.5 text-sm text-textSecondary">
      {children}
    </div>
  );
}
