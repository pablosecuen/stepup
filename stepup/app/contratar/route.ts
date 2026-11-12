import { NextResponse, type NextRequest } from "next/server";
import { readBillingFlags } from "@/lib/billing/flags";
import { PLAN_INTENT_COOKIE, PLAN_INTENT_MAX_AGE_SECONDS, parsePlanIntent, planIntentDestination } from "@/lib/plan-intent";

// «Contratar» desde la página pública de planes. Recuerda QUÉ plan se eligió (sólo su código, en una cookie corta que sobrevive al registro y a la confirmación del correo) y
// sigue a la pantalla de planes del área privada: sin sesión, el acceso pide iniciar sesión (o crear la cuenta) y vuelve ahí. No crea ningún pago ni activa nada: el servidor
// vuelve a resolver el plan desde el catálogo cuando se arma la pantalla y cuando se abre el pago.
export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const { origin, searchParams } = request.nextUrl;
  // Con la facturación apagada no hay contratación: se vuelve a la página pública de planes, sin guardar nada.
  if (!readBillingFlags(process.env).enabled) return NextResponse.redirect(`${origin}/planes`, 303);
  const plan = parsePlanIntent(searchParams.get("plan"));
  if (!plan) return NextResponse.redirect(`${origin}/planes`, 303);
  const response = NextResponse.redirect(`${origin}${planIntentDestination(plan)}`, 303);
  response.cookies.set(PLAN_INTENT_COOKIE, plan, { path: "/", maxAge: PLAN_INTENT_MAX_AGE_SECONDS, httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  response.headers.set("cache-control", "no-store");
  return response;
}
