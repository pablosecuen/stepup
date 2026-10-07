// Páginas de Production con una cuenta SINTÉTICA autenticada por cookies (mismo formato que usa la web: @supabase/ssr), sin escribir credenciales en ningún formulario.
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
const K = JSON.parse(fs.readFileSync(process.env.KEYS_FILE, "utf8"));
const REF = fs.readFileSync("supabase/.temp/project-ref", "utf8").trim();
const URL_ = `https://${REF}.supabase.co`;
const SITE = "https://teacherflowapp.com";
const admin = createClient(URL_, K.service_role, { auth: { persistSession: false, autoRefreshToken: false } });
const RUN = randomBytes(3).toString("hex");
const email = `r8reg-pg-${RUN}@example.invalid`, pw = `Paginas-${RUN}z`;
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? "✓" : "✗"} ${name}${!ok && detail ? "  → " + detail : ""}`); };
const u = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true });
const uid = u.data.user.id;
try {
  // sesión con el mismo formato de cookies que la web
  const jar = new Map();
  const ssr = createServerClient(URL_, K.anon, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (cs) => cs.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))) } });
  const li = await ssr.auth.signInWithPassword({ email, password: pw });
  check("sesión sintética creada con @supabase/ssr (cookies de la web)", !li.error && jar.size > 0, li.error?.message);
  const cookieHeader = () => [...jar].map(([n, v]) => `${n}=${v}`).join("; ");
  // datos sintéticos para que las páginas rendericen contenido real
  const ctx = { supabase: createClient(URL_, K.anon, { global: { headers: { Authorization: `Bearer ${li.data.session.access_token}` } }, auth: { persistSession: false, autoRefreshToken: false } }) };
  const mkS = (n, name) => ctx.supabase.rpc("create_student_with_operation", { p_operation_id: randomUUID(), p_payload: { name, modality: "presencial", category: "otro", billingType: "mensual", dateJoined: "2026-10-07", price: 10000, levels: [] }, p_confirm_duplicate: false });
  const s1 = (await mkS(1, "QA Paginas Uno")).data?.[0]?.student_id;
  check("alumno sintético creado para renderizar las páginas", !!s1);
  const out = [];
  const routes = ["/inicio", "/alumnos", "/calendario", "/cobros", "/registro", "/configuracion", "/configuracion/respaldo", "/resumen-financiero", "/recordatorios", "/alumnos/nuevo"];
  for (const r of routes) {
    const t0 = Date.now();
    const res = await fetch(SITE + r, { headers: { cookie: cookieHeader() }, redirect: "manual" });
    const html = await res.text();
    const text = html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const bad = /Algo sali[óo] mal|Application error|Internal Server Error|PGRST\d|JWT|No hay una sesi[óo]n/i.test(text);
    out.push({ r, status: res.status, ms: Date.now() - t0, bad });
    check(`${r}: 200, renderiza sin errores visibles`, res.status === 200 && !bad && text.length > 200, `${res.status} ${bad ? "(texto de error)" : ""} loc=${res.headers.get("location") ?? ""}`);
    if (r === "/alumnos") check("/alumnos muestra el alumno sintético", /QA Paginas Uno/.test(text));
  }
  // Dos «pestañas» del lado del servidor: el access token del cookie vencido y las DOS solicitudes llegan a la vez (refresco concurrente con el mismo refresh token)
  const stale = new Map(jar);
  for (const [n, v] of stale) {
    if (/auth-token$/.test(n)) {
      const raw = v.startsWith("base64-") ? JSON.parse(Buffer.from(v.slice(7), "base64url").toString()) : JSON.parse(v);
      raw.expires_at = Math.floor(Date.now() / 1000) - 60;
      stale.set(n, "base64-" + Buffer.from(JSON.stringify(raw)).toString("base64url"));
    }
  }
  const hdr = [...stale].map(([n, v]) => `${n}=${v}`).join("; ");
  const [p1, p2, p3] = await Promise.all(["/inicio", "/alumnos", "/inicio"].map((r) => fetch(SITE + r, { headers: { cookie: hdr }, redirect: "manual" })));
  const t1 = (await p1.text()).length, t2 = (await p2.text()).length;
  check("dos pestañas con la sesión vencida pidiendo a la vez: las tres respuestas siguen autenticadas (200, sin redirigir a /login)", [p1, p2, p3].every((p) => p.status === 200) && t1 > 1000 && t2 > 1000, [p1.status, p2.status, p3.status].join("/") + " " + [p1, p2, p3].map((p) => p.headers.get("location") ?? "").join(","));
  const setc = [p1, p2, p3].map((p) => (p.headers.getSetCookie?.() ?? []).filter((c) => /auth-token/.test(c)).length);
  console.log("   (cookies de sesión renovadas por respuesta:", setc.join("/"), ")");
  // Sin cookies: protegidas
  const anon = await fetch(SITE + "/alumnos", { redirect: "manual" });
  check("sin sesión, una página protegida redirige a /login", anon.status >= 300 && anon.status < 400 && /\/login/.test(anon.headers.get("location") ?? ""));
  // Cabeceras y cookies de la web
  const hdrs = await fetch(SITE + "/login");
  const sc = hdrs.headers.getSetCookie?.() ?? [];
  check("cabeceras de seguridad presentes (HSTS, X-Frame-Options, nosniff, Referrer-Policy)", hdrs.headers.get("strict-transport-security") && hdrs.headers.get("x-frame-options") === "DENY" && hdrs.headers.get("x-content-type-options") === "nosniff" && hdrs.headers.get("referrer-policy"));
  const authCookie = (await fetch(SITE + "/alumnos", { headers: { cookie: hdr }, redirect: "manual" })).headers.getSetCookie?.().filter((c) => /auth-token/.test(c)) ?? [];
  const flags = authCookie.map((c) => ({ httpOnly: /httponly/i.test(c), secure: /secure/i.test(c), sameSite: (c.match(/samesite=(\w+)/i) ?? [])[1] }));
  console.log("   cookies de sesión (banderas):", JSON.stringify(flags), "| cookies en /login:", sc.length);
  fs.writeFileSync(process.env.OUT_FILE, JSON.stringify({ out, results, flags }, null, 1));
} finally {
  await admin.auth.admin.deleteUser(uid);
  const left = await admin.auth.admin.listUsers({ perPage: 1000 });
  console.log("usuario sintético borrado:", !left.data.users.some((x) => x.id === uid));
}
const bad = results.filter((r) => !r.ok); console.log(`\n${results.length - bad.length}/${results.length} OK`);
