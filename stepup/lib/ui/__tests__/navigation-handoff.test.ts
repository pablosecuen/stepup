import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {sharedNameForText} from "../shared-name.ts";
const read=(path:string)=>readFileSync(new URL(`../../../${path}`,import.meta.url),"utf8").replace(/\r\n/g,"\n");

test("los nombres compartidos tienen identidad estable, sin depender de la posición o del tamaño",()=>{
  assert.equal(sharedNameForText("QA Uno"),sharedNameForText(" QA Uno "));
  assert.notEqual(sharedNameForText("QA Uno"),sharedNameForText("QA Dos"));
  assert.match(sharedNameForText("María de los Ángeles"),/^tf-name-[a-z0-9]+$/);
});
test("la ficha sólo activa la precarga completa después de intención válida, no para todas las filas",()=>{
  const source=read("components/nav/private-link.tsx");
  assert.match(source,/useState<string \| null>\(null\)/);
  assert.ok(source.indexOf("shouldPrefetchOnIntent({") < source.indexOf("setProfilePrefetchHref(href)"));
  assert.match(source,/isStudentProfilePathname\(pathname\)\) \{\s*setProfilePrefetchHref\(href\)/);
  assert.match(source,/prefetch=\{profilePrefetchHref !== null && profilePrefetchHref === props\.href\}/);
  assert.doesNotMatch(source,/useEffect|setInterval/);
});
test("una respuesta rápida evita el esqueleto optimista y una respuesta abandonada no lo publica tarde",()=>{
  const source=read("components/nav/screen-slot.tsx");
  assert.match(source,/SKELETON_AFTER_MS = 100/);
  assert.match(source,/getPendingNavigation\(\) === active/);
  assert.match(source,/visible !== active/);
  assert.match(source,/clearTimeout\(timer\)/);
  assert.doesNotMatch(source,/minimumDuration|MIN_DISPLAY|requestAnimationFrame|animationend/);
});
test("los límites de carga de una sección eligen el destino real también al abrir sus pantallas hijas",()=>{
  const source=read("components/nav/destination-skeleton.tsx");
  assert.match(source,/pending\?\.destination \?\? pathname/);
  assert.match(source,/resolveScreen\(candidate\) \? candidate : fallbackPath/);
  for(const path of ["alumnos","cobros","registro","calendario","configuracion","resumen-financiero","facturacion"]){
    assert.match(read(`app/(app)/${path}/loading.tsx`),/<DestinationSkeleton fallbackPath=/,path);
  }
});
test("el cambio de gráfico tiene un solo relevo, sin reiniciar la entrada de los datos ni subir otra vez el contenedor",()=>{
  const chart=read("components/finance/collected-evolution-chart.tsx");
  assert.match(chart,/<ViewTransition key=\{presentation\} name="tf-collected-presentation"/);
  assert.match(chart,/startTransition\(\(\) => setPresentation\(mode\)\)/);
  assert.match(chart,/<FinanceMotion signature=\{series\.map/);
  assert.doesNotMatch(chart,/signature=\{`\$\{presentation\}/);
  assert.doesNotMatch(read("app/natural-theme.css"),/animation:tf-chart-enter/);
  assert.match(read("app/(app)/layout.tsx"),/update=\{\{ default: "none", "tf-navigation": "tf-content-swap" \}\}/,"un cambio local de gráfico no vuelve a animar la pantalla entera");
  const marks=read("components/finance/finance-motion.tsx");
  assert.match(marks,/useLayoutEffect/);
  assert.match(marks,/mark\.closest\("svg"\) \?\? mark\.closest\("ul"\)/,"se observa el gráfico real, no toda la tarjeta");
  assert.doesNotMatch(marks,/intersectionRatio/,"un píxel visible alcanza: un gráfico pegado al borde inferior no queda aplastado");
  assert.match(marks,/seen\.get\(entry\.target\) === signature/);
  assert.doesNotMatch(marks,/rootMargin/);
  assert.match(marks,/threshold:\s*0/);
  assert.match(marks,/animation\.pause\(\); animation\.currentTime = 0/,"las marcas esperan sin consumirse fuera de pantalla");
  assert.match(marks,/animations\.forEach\(animation => animation\.play\(\)\)/,"sólo el observador pone el gráfico en marcha");
});

test("el efecto de controles incluye los enlaces del menú y el foco no pierde frente al estilo base",()=>{
  const link=read("components/nav/private-link.tsx");
  assert.match(link,/className=\{`tf-motion-link \$\{props\.className \?\? ""\}`\}/);
  const css=read("app/natural-theme.css");
  const selector='body :is(.tf-motion-link, .tf-motion-button, button:not([role="switch"]):not([role="checkbox"]):not([role="slider"]), summary):not(:where([data-calendar-scroller] *))';
  assert.ok(css.includes(`${selector}:focus-visible { background-size:100% 100%;`));
  assert.ok(css.includes(`${selector}:not(:disabled):not([aria-disabled="true"]):active`));
  assert.match(css,/prefers-reduced-motion:reduce/);
});
test("el encabezado de la ficha no vuelve a subir cuando llega el cuerpo y el movimiento reducido anula el relevo nativo",()=>{
  assert.match(read("components/students/profile/profile-header.tsx"),/<header data-tf-header="">/);
  assert.match(read("components/students/profile/student-profile-view.tsx"),/<div data-tf-static="" className="mt-5">\{children\}/);
  const css=read("app/globals.css");
  assert.match(css,/:root:active-view-transition \.tf-page-main > \.tf-screen > \*/);
  assert.match(css,/@media \(prefers-reduced-motion: reduce\) \{\s*::view-transition-group\(\*\)/);
  assert.match(css,/::view-transition \{ pointer-events: none; \}/);
});

test("el efecto decorativo de relleno, desplazamiento y elevación sólo corre con mouse; el tacto no lo ejecuta ni deja hover pegado", () => {
  const css = read("app/natural-theme.css").replaceAll("\r\n", "\n");
  const open = css.indexOf("@media (hover:hover) and (pointer:fine) {");
  assert.ok(open > 0, "el hover decorativo está dentro de (hover:hover) and (pointer:fine)");
  const mediaBlock = css.slice(open, css.indexOf("\n}\n", open));
  assert.ok(mediaBlock.includes(":hover { background-size:100% 100%; translate:0 -3px; }"), "relleno y elevación al pasar el puntero, sólo con mouse");
  assert.ok(mediaBlock.includes("320ms"), "la animación larga de escritorio vive dentro de la consulta de mouse");
  const outside = css.slice(0, open) + css.slice(open + mediaBlock.length);
  assert.ok(!outside.includes(":hover"), "fuera de la consulta no hay ningún :hover decorativo");
  assert.ok(!outside.includes("320ms"), "el tacto no hereda la transición larga");
  assert.ok(outside.includes(":active { background-size:100% 100%; }"), "pulsación breve para todos los dispositivos");
  assert.ok(outside.includes(":focus-visible { background-size:100% 100%; translate:0 -2px; }"), "el foco visible por teclado se conserva");
  assert.ok(!outside.split("\n").some((line) => line.includes(":active") && line.includes("translate")), "la pulsación nunca desplaza el diseño");
  assert.ok(css.includes("transition:none; translate:none !important;"), "movimiento reducido");
  assert.ok(read("tailwind.config.ts").includes("future: { hoverOnlyWhenSupported: true }"), "los hover: de Tailwind sólo donde hay hover real");
});
