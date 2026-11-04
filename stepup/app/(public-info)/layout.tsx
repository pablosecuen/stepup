import type { ReactNode } from "react";
import Link from "next/link";
import { BrandMark } from "@/components/ui/brand";
import { ButtonLink, TextLink } from "@/components/auth/public-links";
import { PublicFooterLinks } from "@/components/public/public-footer";

export default function PublicInfoLayout({ children }: { children: ReactNode }) {
  return <div className="flex min-h-screen flex-col">
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-4">
        <Link href="/" aria-label="TeacherFlow, inicio"><BrandMark /></Link>
        <nav aria-label="Navegación pública" className="flex flex-wrap items-center gap-3"><TextLink href="/planes">Planes</TextLink><ButtonLink href="/login" variant="secondary">Iniciar sesión</ButtonLink></nav>
      </div>
    </header>
    <main id="contenido" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-5 py-10 focus:outline-none sm:py-14">{children}</main>
    <footer className="border-t border-border px-5 py-6 text-center text-sm text-textSecondary"><PublicFooterLinks /><TextLink href="/">Volver al inicio</TextLink></footer>
  </div>;
}
