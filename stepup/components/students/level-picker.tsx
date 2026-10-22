"use client";

import { useRef, useState } from "react";
import { ChevronDownIcon, PlusIcon } from "@heroicons/react/24/outline";
import { createLevelInlineAction } from "@/lib/actions/students";
import { guardNetwork } from "@/lib/actions/network-guard";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/field";
import { STANDARD_LEVELS } from "@/lib/students/constants";
import { normalizeCustomLevelName, validateLevelName, type CustomLevelRecord } from "@/lib/repositories/custom-levels-mapping";

const CHIP =
  "flex min-h-11 max-w-full cursor-pointer items-center gap-1.5 rounded-pill border-[1.5px] border-borderMid bg-surface px-4 py-1.5 text-[14.5px] font-[650] text-textPrimary transition-colors duration-150 hover:border-ink has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-background has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus";

/**
 * «Niveles» del formulario de alumno, como la app original: los 6 niveles estándar A1–C2 (cada uno se marca o desmarca por separado: se pueden combinar) y, después de C2, el «+» para crear un
 * nivel propio, que queda guardado en la cuenta, seleccionado en este alumno y disponible para los demás. Los niveles propios viven en la fila «Tus niveles» (plegada; si hay alguno elegido, un resumen).
 * Las casillas se llaman `levels` como siempre: el formulario no cambia. Nunca reemplaza ni renombra un nivel existente.
 */
export function LevelPicker({ customLevels: initialCustomLevels, defaultSelected }: { customLevels: CustomLevelRecord[]; defaultSelected: string[] }) {
  const [customLevels, setCustomLevels] = useState(initialCustomLevels);
  const [selected, setSelected] = useState<string[]>(defaultSelected);
  const [expanded, setExpanded] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);

  const toggle = (level: string) => setSelected((current) => (current.includes(level) ? current.filter((x) => x !== level) : [...current, level]));
  const selectedCustom = customLevels.filter((level) => selected.includes(level.name));
  // Un nivel que el alumno ya tiene pero que no figura entre los de la cuenta (importado o renombrado) se conserva y se muestra: nunca se pierde en silencio.
  const known = new Set([...STANDARD_LEVELS, ...customLevels.map((l) => l.name)]);
  const orphans = selected.filter((level) => !known.has(level));

  async function create() {
    setError(null);
    const invalid = validateLevelName(name, customLevels);
    if (invalid) {
      setError(invalid.message);
      nameInput.current?.focus();
      return;
    }
    setBusy(true);
    const result = await guardNetwork(() => createLevelInlineAction(name));
    setBusy(false);
    if (result.error || !result.data) {
      setError(result.error ?? "No se pudo crear el nivel. Probá de nuevo.");
      return;
    }
    const created = result.data;
    setCustomLevels((current) => (current.some((l) => l.id === created.id) ? current : [...current, { id: created.id, name: created.name, createdAt: new Date().toISOString() }]));
    setSelected((current) => (current.includes(created.name) ? current : [...current, created.name]));
    setExpanded(true);
    setCreating(false);
    setName("");
  }

  const chip = (level: string) => (
    <label key={level} className={CHIP}>
      <input type="checkbox" name="levels" value={level} checked={selected.includes(level)} onChange={() => toggle(level)} className="peer sr-only" />
      <span aria-hidden className="hidden text-xs font-bold peer-checked:inline">
        ✓
      </span>
      <span className="[overflow-wrap:anywhere]">{level}</span>
    </label>
  );

  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="text-sm font-[650] text-textSecondary">Niveles</legend>
      <div className="flex flex-wrap gap-2">
        {STANDARD_LEVELS.map(chip)}
        <button
          type="button"
          onClick={() => {
            setCreating(true);
            setError(null);
          }}
          aria-label="Crear nivel personalizado"
          aria-expanded={creating}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-pill border-[1.5px] border-border bg-surface2 text-textSecondary hover:border-ink hover:text-textPrimary"
        >
          <PlusIcon className="h-5 w-5" aria-hidden />
        </button>
      </div>

      {creating && (
        // No es un <form> anidado: está dentro del formulario del alumno. Enter agrega el nivel (no envía el alumno).
        <div role="group" aria-label="Crear nivel personalizado" className="flex flex-col gap-2 rounded-md border-[1.5px] border-borderMid bg-surface2 p-3">
          <label htmlFor="new-level-name" className="text-sm font-[650] text-textSecondary">
            Nombre del nivel nuevo
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <TextInput
              id="new-level-name"
              ref={nameInput}
              value={name}
              maxLength={40}
              autoFocus
              autoComplete="off"
              placeholder="Ej. Infantes, Preparación First…"
              className="min-w-[10rem] flex-1"
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void create();
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setCreating(false);
                  setError(null);
                }
              }}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "new-level-error" : undefined}
            />
            <Button variant="secondary" busy={busy} disabled={busy || normalizeCustomLevelName(name) === ""} onClick={() => void create()}>
              {busy ? "Guardando..." : "Crear nivel"}
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setCreating(false);
                setError(null);
                setName("");
              }}
            >
              Cancelar
            </Button>
          </div>
          {error && (
            <p id="new-level-error" role="alert" className="text-[13.5px] font-semibold text-bad">
              {error}
            </p>
          )}
          <p className="text-[13px] text-textMuted">Se suma a A1–C2, queda guardado en tu cuenta y se elige para este alumno.</p>
        </div>
      )}

      {(customLevels.length > 0 || orphans.length > 0) && (
        <div className="flex flex-col gap-2">
          <button type="button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} className="flex min-h-9 w-full items-center gap-2 text-left text-[14px] font-[650] text-textSecondary">
            <span>Tus niveles</span>
            {!expanded && selectedCustom.length + orphans.length > 0 && <span className="min-w-0 truncate text-textMuted">· {[...selectedCustom.map((l) => l.name), ...orphans].join(", ")}</span>}
            <ChevronDownIcon className={`ml-auto h-4 w-4 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden />
          </button>
          {/* Plegada, las casillas siguen en el formulario (ocultas) para que lo elegido se guarde igual. */}
          <div className={expanded ? "flex flex-wrap gap-2" : "hidden"}>
            {customLevels.map((level) => chip(level.name))}
            {orphans.map(chip)}
          </div>
        </div>
      )}
    </fieldset>
  );
}
