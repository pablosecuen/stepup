"use client";

import { usePathname } from "next/navigation";
import type { ComponentType, SVGProps } from "react";
import {
  Cog6ToothIcon,
  CreditCardIcon,
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
import { SignOutButton } from "@/components/nav/sign-out-button";
import { BrandMark } from "@/components/ui/brand";
import { PRIMARY_NAV_ITEMS, isPrimaryNavActive, isPrimarySectionActive, type PrimaryNavIconKey } from "@/lib/nav/primary-nav-items";

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
      <BrandMark size="sm" compact />
    </PrivateLink>
  );
}

/**
 * Shell de navegación del área privada (rediseño visual v1, docs/design/web-v1/02-componentes-y-navegacion.md §9).
 *  - Escritorio (≥ 820 px): barra lateral oscura de 236 px con logo, los cinco destinos y, abajo y separado, el acceso directo a
 *    «Configuración» (un enlace, no un menú). «Cerrar sesión» NO está acá: vive arriba a la derecha del área principal (`SessionBar`).
 *  - Móvil: encabezado con logo, el acceso directo a «Configuración» (un enlace propio) y «Cerrar sesión» (único control de sesión),
 *    más la barra inferior con los mismos cinco destinos. Objetivos táctiles de 44 px como mínimo; respeta las safe areas.
 * Activo por segmento completo (destino o subruta). Ningún enlace precarga (`PrivateLink`).
 */
export function PrimaryNav({ billingEnabled = false }: { billingEnabled?: boolean }) {
  const pathname = usePathname();
  const settingsActive = isPrimaryNavActive(pathname, "/configuracion");
  const billingActive = isPrimaryNavActive(pathname, "/facturacion");

  return (
    <>
      <header className="sticky top-0 z-30 border-b-[1.5px] border-border bg-background/95 pt-[env(safe-area-inset-top)] nav:hidden">
        <div className="flex min-h-[58px] items-center justify-between gap-3 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]">
          <Logo className="text-textPrimary" />
          <div className="flex items-center gap-1">
            <PrivateLink
              href="/configuracion"
              aria-label="Configuración"
              aria-current={settingsActive ? "page" : undefined}
              className={`flex h-11 w-11 items-center justify-center rounded-md transition-colors duration-150 hover:bg-paperDeep ${settingsActive ? "bg-accentSoft text-accentText" : "text-textSecondary"}`}
            >
              <Cog6ToothIcon className="h-6 w-6" aria-hidden />
            </PrivateLink>
            <SignOutButton iconOnlyBelowSm />
          </div>
        </div>
      </header>

      <nav
        aria-label="Navegación principal"
        className="fixed inset-x-0 bottom-0 z-20 border-t-[1.5px] border-borderMid bg-surface pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] nav:hidden"
      >
        <ul className="grid grid-cols-5 px-1 pt-1.5">
          {PRIMARY_NAV_ITEMS.map((item) => {
            const isActive = isPrimarySectionActive(pathname, item);
            const Icon = isActive ? ICONS[item.icon].solid : ICONS[item.icon].outline;
            return (
              <li key={item.href} className="min-w-0">
                <PrivateLink
                  href={item.href}
                  aria-current={isActive ? (isPrimaryNavActive(pathname, item.href) ? "page" : "true") : undefined}
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
              const isActive = isPrimarySectionActive(pathname, item);
              const Icon = isActive ? ICONS[item.icon].solid : ICONS[item.icon].outline;
              return (
                <li key={item.href}>
                  <PrivateLink
                    href={item.href}
                    aria-current={isActive ? (isPrimaryNavActive(pathname, item.href) ? "page" : "true") : undefined}
                    className={`relative flex min-h-[46px] items-center gap-3 rounded-[12px] px-3 text-[15px] transition-colors duration-150 ${
                      isActive
                        ? "bg-sideActive font-bold text-white before:absolute before:-left-3 before:bottom-[11px] before:top-[11px] before:w-1 before:rounded-r before:bg-sideAccent"
                        : "font-medium text-sideText hover:bg-side2 hover:text-white"
                    }`}
                  >
                    <Icon className="h-5 w-5 shrink-0" aria-hidden />
                    {item.label}
                  </PrivateLink>
                  {/* Entradas secundarias de la sección (siempre presentes: ni ensanchan la barra ni mueven a las demás secciones). */}
                  {item.secondary && (
                    <ul className="mt-[3px] flex flex-col gap-[3px]">
                      {item.secondary.map((child) => {
                        const childActive = isPrimaryNavActive(pathname, child.href);
                        return (
                          <li key={child.href}>
                            <PrivateLink
                              href={child.href}
                              aria-current={childActive ? "page" : undefined}
                              className={`relative flex min-h-11 items-center truncate rounded-[10px] pl-11 pr-3 text-[14px] transition-colors duration-150 ${
                                childActive ? "bg-side2 font-bold text-white" : "font-medium text-sideText hover:bg-side2 hover:text-white"
                              }`}
                            >
                              {child.label}
                            </PrivateLink>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>
        {/* Acceso directo a Configuración: un enlace (no un menú), separado de la navegación principal. */}
        <div className="mt-2 flex flex-col gap-[3px] border-t border-sideLine pt-3">
          {/* Sólo con la facturación encendida: apagada, la barra es exactamente la de siempre. */}
          {billingEnabled && (
            <PrivateLink
              href="/facturacion"
              aria-current={billingActive ? "page" : undefined}
              className={`flex min-h-[46px] items-center gap-3 rounded-[12px] px-3 text-[15px] transition-colors duration-150 ${billingActive ? "bg-sideActive font-bold text-white" : "font-medium text-sideText hover:bg-side2 hover:text-white"}`}
            >
              <CreditCardIcon className="h-5 w-5 shrink-0" aria-hidden />
              Facturación
            </PrivateLink>
          )}
          <PrivateLink
            href="/configuracion"
            aria-current={settingsActive ? "page" : undefined}
            className={`flex min-h-[46px] items-center gap-3 rounded-[12px] px-3 text-[15px] transition-colors duration-150 ${settingsActive ? "bg-sideActive font-bold text-white" : "font-medium text-sideText hover:bg-side2 hover:text-white"}`}
          >
            <Cog6ToothIcon className="h-5 w-5 shrink-0" aria-hidden />
            Configuración
          </PrivateLink>
        </div>
      </div>
    </>
  );
}
