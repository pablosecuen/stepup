import NextLink from "next/link";
import type { ComponentProps } from "react";

/**
 * `next/link` SIN precarga, para toda ruta del área privada. Por defecto Next precarga cada `<Link>` que entra al
 * viewport (y el layout privado es dinámico: cada precarga vuelve a ejecutar su verificación de sesión): con una sesión
 * recién creada eso dispara ráfagas de consultas (B0, "JWT issued at future"). `prefetch={false}` no precarga ni al entrar
 * al viewport ni al pasar el mouse (docs de Next 16). El prop no se puede reactivar desde afuera.
 */
export type PrivateLinkProps = Omit<ComponentProps<typeof NextLink>, "prefetch">;

export default function PrivateLink(props: PrivateLinkProps) {
  return <NextLink {...props} prefetch={false} />;
}
