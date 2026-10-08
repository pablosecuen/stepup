"use client";

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
import { BrandMark } from "@/components/ui/brand";
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
      className={`flex min-h-11 w-fit items-center rounded-md ${className}`}
    >
      <BrandMark size="sm" />
    </PrivateLink>
  );
}

/**
 * Shell de navegación del área privada (rediseño visual v1, docs/design/web-v1/02-componentes-y-navegacion.md §9).
 *  - Escritorio (≥ 820 px): barra lateral oscura de 236 px con logo, los cinco destinos y, abajo, el bloque de cuenta (que abre el
 *    menú de cuenta).
 *  - Móvil: encabezado con logo y botón de cuenta + barra inferior con los mismos cinco destinos. Objetivos táctiles de
 *    44 px como mínimo; respeta las safe areas (muesca, barra de inicio, bordes laterales).
 * Activo por segmento completo (destino o subruta). Ningún enlace precarga (`PrivateLink`).
 */
export function PrimaryNav({ account }: { account: AccountIdentity }) {
  const pathname = usePathname();

  return (
    <>
      {/* Sin `backdrop-blur`: un filtro de fondo haría de este encabezado el bloque contenedor del menú de cuenta (hoja inferior fija). */}
      <header className="sticky top-0 z-30 border-b-[1.5px] border-border bg-background/95 pt-[env(safe-area-inset-top)] nav:hidden">
        <div className="flex min-h-[58px] items-center justify-between gap-3 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]">
          <Logo className="text-textPrimary" />
          <AccountMenu identity={account} variant="header" />
        </div>
      </header>

      <nav
        aria-label="Navegación principal"
        className="fixed inset-x-0 bottom-0 z-20 border-t-[1.5px] border-borderMid bg-surface pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] nav:hidden"
      >
        <ul className="grid grid-cols-5 px-1 pt-1.5">
          {PRIMARY_NAV_ITEMS.map((item) => {
            const isActive = isPrimaryNavActive(pathname, item.href);
            const Icon = isActive ? ICONS[item.icon].solid : ICONS[item.icon].outline;
            return (
              <li key={item.href} className="min-w-0">
                <PrivateLink
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={`group flex min-h-16 flex-col items-center justify-center gap-[3px] px-0.5 text-[11.5px] leading-none transition-transform duration-150 ease-premium active:scale-95 max-[360px]:text-[10.5px] ${
                    isActive ? "font-bold text-textPrimary" : "font-semibold text-textMuted"
                  }`}
                >
                  <span
                    className={`flex h-[30px] w-[52px] items-center justify-center rounded-pill transition-colors duration-200 ease-premium max-[360px]:w-11 ${
                      isActive ? "bg-accentSoft text-accentText" : "group-active:bg-paperDeep"
                    }`}
                  >
                    <Icon className="h-6 w-6" aria-hidden />
                  </span>
                  <span>{item.label}</span>
                </PrivateLink>
              </li>
            );
          })}
        </ul>
      </nav>

      <div data-surface="dark" className="fixed inset-y-0 left-0 z-20 hidden w-[236px] flex-col bg-side px-3 pb-3 pt-[18px] nav:flex">
        <div className="px-2 pb-[18px]">
          <Logo className="text-background" />
        </div>
        <nav aria-label="Navegación principal" className="-mx-3 flex-1 overflow-y-auto overflow-x-hidden px-3">
          <ul className="flex flex-col gap-[3px]">
            {PRIMARY_NAV_ITEMS.map((item) => {
              const isActive = isPrimaryNavActive(pathname, item.href);
              const Icon = isActive ? ICONS[item.icon].solid : ICONS[item.icon].outline;
              return (
                <li key={item.href}>
                  <PrivateLink
                    href={item.href}
                    aria-current={isActive ? "page" : undefined}
                    className={`relative flex min-h-[46px] items-center gap-3 rounded-[12px] px-3 text-[15px] transition-colors duration-150 ${
                      isActive
                        ? "bg-sideActive font-bold text-white before:absolute before:-left-3 before:bottom-[11px] before:top-[11px] before:w-1 before:rounded-r before:bg-sideAccent"
                        : "font-medium text-sideText hover:bg-side2 hover:text-white"
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
        <AccountMenu identity={account} variant="sidebar" />
      </div>
    </>
  );
}
