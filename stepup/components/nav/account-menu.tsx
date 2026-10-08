"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import { ArrowRightOnRectangleIcon, ChevronUpDownIcon, Cog6ToothIcon } from "@heroicons/react/24/outline";
import PrivateLink from "@/components/nav/private-link";
import { Avatar } from "@/components/ui/avatar";
import { MENU_ITEM, MENU_ITEM_DANGER, MENU_PANEL, MENU_SEPARATOR } from "@/components/ui/menu-styles";
import { guardNetwork } from "@/lib/actions/network-guard";
import { requestSignOut } from "@/lib/nav/request-sign-out";
import type { AccountIdentity } from "@/lib/nav/account-identity";
import { menuKeyAction, triggerKeyAction } from "@/lib/nav/menu-keyboard";

type AccountMenuVariant = "sidebar" | "header";

/**
 * Menú de cuenta (patrón "menu button" de WAI-ARIA): nombre y correo, Configuración y Cerrar sesión.
 * Teclado: Enter/Espacio/↓ abren y enfocan el primer elemento, ↑ el último; ↑/↓/Inicio/Fin se mueven; Escape cierra y
 * devuelve el foco al botón; Tab cierra. Clic fuera o foco que sale del menú lo cierra. Cambiar de ruta lo cierra.
 *
 * Rediseño visual v1: en la barra lateral (escritorio) es un panel que se abre hacia arriba; en la barra superior (móvil) es una
 * hoja inferior con fondo atenuado. Sólo cambia el aspecto: el comportamiento y la semántica son los de siempre.
 */
export function AccountMenu({ identity, variant }: { identity: AccountIdentity; variant: AccountMenuVariant }) {
  const pathname = usePathname();
  const baseId = useId();
  const triggerId = `${baseId}-trigger`;
  const menuId = `${baseId}-menu`;
  const [open, setOpen] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [signingOut, startSignOut] = useTransition();
  const [lastPathname, setLastPathname] = useState(pathname);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<"first" | "last" | null>(null);

  // Una navegación (p. ej. a Configuración) cierra el menú.
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setOpen(false);
  }

  // Cerrar sesión es una acción propia (botón, nunca un enlace): reusa el Server Action existente (signOutAction) a través de
  // guardNetwork, así una falla de red se muestra como mensaje en el menú en vez de romper la pantalla.
  function signOut() {
    setSignOutError(null);
    startSignOut(async () => {
      const result = await guardNetwork(() => requestSignOut());
      if (result.error) setSignOutError(result.error);
    });
  }

  const menuItems = (): HTMLElement[] => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  function close(restoreFocus: boolean) {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }

  // Al abrirse, enfoca el elemento pedido (el primero si se abrió con clic/Enter/Espacio).
  useEffect(() => {
    if (!open || !pendingFocus.current) return;
    const items = menuItems();
    (pendingFocus.current === "last" ? items[items.length - 1] : items[0])?.focus();
    pendingFocus.current = null;
  }, [open]);

  // Clic o toque fuera del menú: se cierra sin mover el foco (queda donde la persona tocó).
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!open) {
      if (event.target !== triggerRef.current) return;
      const action = triggerKeyAction(event.key);
      if (!action) return;
      event.preventDefault();
      pendingFocus.current = action.focus;
      setOpen(true);
      return;
    }
    const items = menuItems();
    const action = menuKeyAction(event.key, items.indexOf(document.activeElement as HTMLElement), items.length);
    if (action.kind === "focus") {
      event.preventDefault();
      items[action.index]?.focus();
    } else if (action.kind === "close") {
      if (action.restoreFocus) event.preventDefault();
      close(action.restoreFocus);
    }
  }

  // Si el foco pasa a otro elemento de la página, el menú se cierra (un blur sin destino, p. ej. tocar el relleno del
  // propio menú, no lo cierra).
  function onBlur(event: React.FocusEvent<HTMLDivElement>) {
    const next = event.relatedTarget as Node | null;
    if (open && next && !containerRef.current?.contains(next)) setOpen(false);
  }

  const isSidebar = variant === "sidebar";
  const itemClass = `${MENU_ITEM}${isSidebar ? "" : " min-h-14"}`;

  return (
    <div ref={containerRef} className="relative" onKeyDown={onKeyDown} onBlur={onBlur}>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={isSidebar ? undefined : `Menú de cuenta de ${identity.primary}`}
        onClick={() => {
          if (open) {
            setOpen(false);
            return;
          }
          pendingFocus.current = "first";
          setOpen(true);
        }}
        className={
          isSidebar
            ? "flex min-h-14 w-full items-center gap-2.5 rounded-[12px] p-2 text-left transition-colors duration-150 hover:bg-side2 aria-expanded:bg-side2"
            : "flex h-11 w-11 items-center justify-center rounded-full transition-transform duration-150 active:scale-95"
        }
      >
        <Avatar initial={identity.initial} tone={0} size={isSidebar ? "m" : "h"} className={isSidebar ? "" : "ring-[1.5px] ring-borderMid"} />
        {isSidebar && (
          <>
            <span className="min-w-0 flex-1">
              <span className="sr-only">Menú de cuenta: </span>
              <span className="block truncate font-display text-base font-medium leading-tight text-white">{identity.primary}</span>
              {identity.secondary && <span className="block truncate text-[12.5px] text-sideMuted">{identity.secondary}</span>}
            </span>
            <ChevronUpDownIcon className="h-4 w-4 shrink-0 text-sideMuted" aria-hidden />
          </>
        )}
      </button>

      {open && !isSidebar && <div aria-hidden onClick={() => setOpen(false)} className="fixed inset-0 z-40 animate-tf-fade bg-ink/50" />}

      {open && (
        <div
          className={`${MENU_PANEL} ${
            isSidebar
              ? "absolute bottom-full left-0 z-40 mb-2 w-[292px] text-textPrimary animate-tf-fade"
              : "fixed inset-x-0 bottom-0 z-50 animate-tf-sheet rounded-b-none rounded-t-[24px] border-b-0 pb-[env(safe-area-inset-bottom)]"
          }`}
        >
          {!isSidebar && <div aria-hidden className="mx-auto mt-2.5 h-[5px] w-11 rounded-pill bg-borderMid" />}
          <div className="flex items-center gap-3 border-b-[1.5px] border-border bg-surface2 p-4">
            <Avatar initial={identity.initial} tone={0} size="l" />
            <div className="min-w-0">
              <p className="break-words font-display text-lg font-semibold leading-tight text-textPrimary">{identity.primary}</p>
              {identity.secondary && <p className="break-all text-[13px] text-textMuted">{identity.secondary}</p>}
            </div>
          </div>
          <div ref={menuRef} id={menuId} role="menu" aria-labelledby={triggerId} className="flex flex-col gap-0.5 p-1.5">
            <PrivateLink href="/configuracion" role="menuitem" tabIndex={-1} onClick={() => close(true)} className={itemClass}>
              <Cog6ToothIcon className="h-5 w-5 shrink-0 text-textSecondary" aria-hidden />
              Configuración
            </PrivateLink>
            <div role="none" className={MENU_SEPARATOR} />
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              aria-disabled={signingOut}
              disabled={signingOut}
              onClick={signOut}
              className={`${itemClass} ${MENU_ITEM_DANGER} disabled:opacity-60`}
            >
              <ArrowRightOnRectangleIcon className="h-5 w-5 shrink-0" aria-hidden />
              {signingOut ? "Cerrando sesión…" : "Cerrar sesión"}
            </button>
          </div>
          {signOutError && (
            <p role="alert" className="border-t-[1.5px] border-border px-4 py-2.5 text-[13.5px] font-semibold text-bad">
              {signOutError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
