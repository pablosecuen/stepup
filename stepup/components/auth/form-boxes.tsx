import { Notice } from "@/components/ui/notice";

// Mismo patrón que móvil (errorBox/infoBox en accountStyles.ts): error e
// información en línea, nunca un toast — siempre justo debajo del campo o
// botón al que corresponden. Rediseño visual v1: ícono + texto + tono
// (components/ui/notice.tsx); el comportamiento (role="alert" / "status") no cambia.
export function FormErrorBox({ message }: { message: string }) {
  return (
    <Notice tone="bad" role="alert">
      {message}
    </Notice>
  );
}

export function FormInfoBox({ children }: { children: React.ReactNode }) {
  return (
    <Notice tone="info" role="status">
      {children}
    </Notice>
  );
}
