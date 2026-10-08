import { AVATAR_TONE_COUNT } from "@/lib/ui/avatar-tone";

// Avatar con iniciales (en serifa) y uno de seis tonos cálidos (clases `.tf-av-0…5` en app/globals.css; fondo + texto ≥ 4.5:1).
// Decorativo: el nombre siempre aparece en texto al lado (o como `aria-label` del control que lo contiene).

export type AvatarSize = "s" | "m" | "h" | "l" | "xl";

const SIZES: Record<AvatarSize, string> = {
  s: "h-7 w-7 text-[11px]",
  m: "h-9 w-9 text-sm",
  // 40 px: el botón de cuenta de la barra superior móvil.
  h: "h-10 w-10 text-base",
  l: "h-12 w-12 text-lg",
  xl: "h-[72px] w-[72px] text-[28px]",
};

export function Avatar({ initial, tone = 0, size = "m", className }: { initial: string; tone?: number; size?: AvatarSize; className?: string }) {
  const safeTone = Math.abs(Math.trunc(tone)) % AVATAR_TONE_COUNT;
  return (
    <span aria-hidden className={`inline-flex shrink-0 items-center justify-center rounded-pill font-display font-semibold tracking-tight tf-av-${safeTone} ${SIZES[size]}${className ? ` ${className}` : ""}`}>
      {initial}
    </span>
  );
}
