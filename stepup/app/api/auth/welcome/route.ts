import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { LOGIN_MOTION_COOKIE } from "@/lib/ui/login-motion";

/** Consumes only the short-lived visual marker; never changes the authenticated session. */
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return new NextResponse(null, { status: 403 });
  (await cookies()).delete(LOGIN_MOTION_COOKIE);
  return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
