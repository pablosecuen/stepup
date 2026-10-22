import { test } from "node:test";
import assert from "node:assert/strict";
import { editRegistrationHref, safeCalendarReturn } from "../return-path.ts";

test("sólo se acepta volver a una ruta interna del Calendario (semana o día), nunca otro destino", () => {
  assert.equal(safeCalendarReturn("/calendario"), "/calendario");
  assert.equal(safeCalendarReturn("/calendario?view=day&day=2026-10-21"), "/calendario?view=day&day=2026-10-21");
  assert.equal(safeCalendarReturn("/calendario?view=week&week=2026-10-19"), "/calendario?view=week&week=2026-10-19");
  for (const bad of ["https://evil.example/calendario", "//evil.example", "/alumnos", "/calendario/../alumnos", "/calendario?x=<script>", "javascript:alert(1)", "", undefined, null, 5, "/calendario#frag", "/calendarioX"]) {
    assert.equal(safeCalendarReturn(bad), null, String(bad));
  }
});

test("el enlace de «Editar registro» lleva el id de la clase y, si es válido, a dónde volver", () => {
  assert.equal(editRegistrationHref("abc-123", null), "/registro/abc-123");
  assert.equal(editRegistrationHref("abc-123", "/calendario?view=day&day=2026-10-21"), "/registro/abc-123?volver=%2Fcalendario%3Fview%3Dday%26day%3D2026-10-21");
  assert.equal(editRegistrationHref("abc-123", "https://evil.example"), "/registro/abc-123");
});
