"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import type { ComponentType, SVGProps } from "react";
import {
  HomeIcon,
  UsersIcon,
  CalendarDaysIcon,
  BanknotesIcon,
  ClipboardDocumentCheckIcon,
} from "@heroicons/react/24/outline";
import {
  HomeIcon as HomeIconSolid,
  UsersIcon as UsersIconSolid,
  CalendarDaysIcon as CalendarDaysIconSolid,
  BanknotesIcon as BanknotesIconSolid,
  ClipboardDocumentCheckIcon as ClipboardDocumentCheckIconSolid,
} from "@heroicons/react/24/solid";
import PrivateLink from "@/components/nav/private-link";
import { AccountMenu } from "@/components/nav/account-menu";
import type { AccountIdentity } from "@/lib/nav/account-identity";
import { PRIMARY_NAV_ITEMS, isPrimaryNavActive, type PrimaryNavIconKey } from "@/lib/nav/primary-nav-items";

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

const ICONS: Record<PrimaryNavIconKey, { outline: IconComponent; solid: IconComponent }> = {
  home: { outline: HomeIcon, solid: HomeIconSolid },
  students: { outline: UsersIcon, solid: UsersIconSolid },
  calendar: { outline: CalendarDaysIcon, solid: CalendarDaysIconSolid },
  payments: { outline: BanknotesIcon, solid: BanknotesIconSolid },
  registry: { outline: ClipboardDocumentCheckIcon, solid: ClipboardDocumentCheckIconSolid },
};

function Logo({ className = "" }: { className?: string }) {
  return (
    <PrivateLink
      href="/inicio"
      aria-label="TeacherFlow, ir a Inicio"
      className={`flex min-h-11 items-center gap-2.5 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue ${className}`}
    >
      <Image src="/icon.png" alt="" width={32} height={32} className="rounded-lg" />
      <span className="text-base font-bold tracking-tight text-textPrimary">TeacherFlow</span>
    </PrivateLink>
  );
}

/**
 * Shell de navegación del área privada.
 *  - Escritorio (md+): barra lateral con logo, los cinco destinos y, abajo, el bloque de cuenta (que abre el menú de cuenta).
 *  - Móvil: encabezado con logo y botón de cuenta + barra inferior con los mismos cinco destinos. Objetivos táctiles de
 *    44 px como mínimo; respeta las safe areas (muesca, barra de inicio, bordes laterales).
 * Activo por segmento completo (destino o subruta). Ningún enlace precarga (`PrivateLink`).
 */
export function PrimaryNav({ account }: { account: AccountIdentity }) {
  const pathname = usePathname();

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-border bg-surface/90 pt-[env(safe-area-inset-top)] backdrop-blur-md md:hidden">
        <div className="flex min-h-14 items-center justify-between gap-3 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]">
          <Logo />
          <AccountMenu identity={account} variant="header" />
        </div>
      </header>

      <nav
        aria-label="Navegación principal"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/90 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] backdrop-blur-md md:hidden"
      >
        <ul className="flex">
          {PRIMARY_NAV_ITEMS.map((item) => {
            const isActive = isPrimaryNavActive(pathname, item.href);
            const Icon = isActive ? ICONS[item.icon].solid : ICONS[item.icon].outline;
            return (
              <li key={item.href} className="min-w-0 flex-1">
                <PrivateLink
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className="group flex min-h-16 flex-col items-center justify-center gap-1 px-0.5 text-[11px] font-medium leading-none text-textMuted transition-transform duration-150 ease-premium active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brandBlue"
                >
                  <span
                    className={`flex h-7 w-11 items-center justify-center rounded-pill transition-colors duration-200 ease-premium ${
                      isActive ? "bg-brandBlue/10" : "group-active:bg-background"
                    }`}
                  >
                    <Icon className={`h-5 w-5 ${isActive ? "text-brandBlue" : "text-textMuted"}`} aria-hidden />
                  </span>
                  <span className={isActive ? "text-brandBlue" : ""}>{item.label}</span>
                </PrivateLink>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="fixed inset-y-0 left-0 z-20 hidden w-56 flex-col border-r border-border bg-surface md:flex">
        <div className="px-4 pb-3 pt-5">
          <Logo />
        </div>
        <nav aria-label="Navegación principal" className="flex-1 overflow-y-auto overflow-x-hidden px-4">
          <ul className="flex flex-col gap-1">
            {PRIMARY_NAV_ITEMS.map((item) => {
              const isActive = isPrimaryNavActive(pathname, item.href);
              const Icon = isActive ? ICONS[item.icon].solid : ICONS[item.icon].outline;
              return (
                <li key={item.href}>
                  <PrivateLink
                    href={item.href}
                    aria-current={isActive ? "page" : undefined}
                    className={`flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-all duration-150 ease-premium focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue ${
                      isActive
                        ? "bg-brandBlue/10 text-brandBlue"
                        : "text-textSecondary hover:translate-x-0.5 hover:bg-background hover:text-textPrimary"
                    }`}
                  >
                    <Icon className="h-5 w-5 shrink-0" aria-hidden />
                    {item.label}
                  </PrivateLink>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="border-t border-border p-3">
          <AccountMenu identity={account} variant="sidebar" />
        </div>
      </div>
    </>
  );
}
