"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { LOGIN_MOTION_DURATION_MS, vortexBoundary } from "@/lib/ui/login-motion";

/** Runs after the authenticated layout has admitted this device; never holds up authentication or navigation. */
export function LoginWelcome({ enabled }: { enabled: boolean }) {
  const [visible, setVisible] = useState(enabled);
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const logo = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!enabled || !root.current || !canvas.current || !logo.current) return;
    void fetch("/api/auth/welcome", { method: "POST", credentials: "same-origin" }).catch(() => {});
    const layer = root.current, mark = logo.current, surface = canvas.current;
    layer.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    const ctx = surface.getContext("2d");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0, disposed = false;
    const animations: Animation[] = [];
    const timers: ReturnType<typeof setTimeout>[] = [];
    const finish = () => { if (!disposed) { cancelAnimationFrame(frame); setVisible(false); document.getElementById("contenido")?.focus({ preventScroll: true }); } };
    // This timer is the authority: hidden tabs and paused animation frames cannot trap the user.
    timers.push(setTimeout(finish, reduced ? 180 : LOGIN_MOTION_DURATION_MS));
    if (reduced || !ctx || !layer.animate) { mark.style.opacity = "1"; return () => { disposed = true; timers.forEach(clearTimeout); }; }
    const style = getComputedStyle(layer);
    const brown = style.getPropertyValue("--tf-welcome-brown").trim();
    const cream = style.getPropertyValue("--tf-welcome-cream").trim();
    let width = 0, height = 0;
    function resize() {
      const rect = layer.getBoundingClientRect(), ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      width = rect.width; height = rect.height;
      surface.width = Math.round(width * ratio); surface.height = Math.round(height * ratio);
      ctx!.setTransform(ratio, 0, 0, ratio, 0, 0);
    }
    resize();
    const started = performance.now();
    function draw(now: number) {
      if (disposed) return;
      const p = Math.min(1, (now - started) / 1060), cx = width / 2, cy = height / 2, radius = Math.hypot(width, height) * 0.62;
      ctx!.fillStyle = cream; ctx!.fillRect(0, 0, width, height);
      ctx!.fillStyle = brown; ctx!.beginPath(); ctx!.moveTo(cx, cy);
      for (let j = 0; j <= 160; j++) { const r = radius * j / 160, angle = vortexBoundary(r, radius, p, 0); ctx!.lineTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r); }
      ctx!.arc(cx, cy, radius, Math.PI / 2, Math.PI * 1.5);
      for (let j = 160; j >= 0; j--) { const r = radius * j / 160, angle = vortexBoundary(r, radius, p, 1); ctx!.lineTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r); }
      ctx!.closePath(); ctx!.fill();
      if (p > 0.3) {
        ctx!.save(); ctx!.globalAlpha = Math.min(1, (p - 0.3) / 0.55);
        const wash = ctx!.createRadialGradient(cx, cy, 0, cx, cy, Math.min(width, height) * 0.48);
        wash.addColorStop(0, cream); wash.addColorStop(0.4, cream); wash.addColorStop(1, "transparent");
        ctx!.fillStyle = wash; ctx!.fillRect(0, 0, width, height); ctx!.restore();
      }
      if (now - started < 1180) frame = requestAnimationFrame(draw);
    }
    frame = requestAnimationFrame(draw);
    timers.push(setTimeout(() => {
      mark.style.opacity = "1";
      animations.push(mark.animate([{ opacity: 0, transform: "translateY(10px) scale(.8)" }, { opacity: 1, transform: "translateY(0) scale(1)" }], { duration: 420, easing: "cubic-bezier(.16,.8,.2,1)", fill: "both" }));
    }, 490));
    timers.push(setTimeout(() => {
      animations.push(layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 330, fill: "forwards" }));
    }, 1230));
    window.addEventListener("resize", resize);
    return () => { disposed = true; timers.forEach(clearTimeout); cancelAnimationFrame(frame); animations.forEach(a => a.cancel()); window.removeEventListener("resize", resize); };
  }, [enabled]);

  if (!visible) return null;
  return <div ref={root} className="tf-login-welcome" role="dialog" aria-modal="true" aria-label="Acceso correcto. TeacherFlow, tu lugar para crecer." onKeyDown={event => {
    if (event.key === "Escape") { setVisible(false); document.getElementById("contenido")?.focus({ preventScroll: true }); }
    if (event.key === "Tab") { event.preventDefault(); root.current?.querySelector<HTMLButtonElement>("button")?.focus(); }
  }}>
    <canvas ref={canvas} aria-hidden />
    <div ref={logo} className="tf-login-welcome-brand" aria-hidden>
      <Image src="/icon.png" alt="" width={88} height={88} priority className="rounded-[22px]" />
      <strong className="font-display text-[36px] font-normal tracking-tight">TeacherFlow</strong>
      <span className="text-[16px] tracking-wide">Tu lugar para crecer</span>
    </div>
    <button type="button" onClick={() => { setVisible(false); document.getElementById("contenido")?.focus({ preventScroll: true }); }} className="absolute bottom-[max(1.5rem,var(--tf-safe-bottom))] right-6 min-h-11 rounded-pill border border-borderStrong bg-surface px-4 text-[13px] text-textPrimary focus-visible:outline focus-visible:outline-2">Continuar</button>
  </div>;
}
