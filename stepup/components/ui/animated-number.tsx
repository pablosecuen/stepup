"use client";

import { useLayoutEffect, useRef } from "react";
import { formatCount, formatMoney, formatHours, formatPercent } from "@/lib/format/number-format";

const formats = { money: formatMoney, count: formatCount, hours: formatHours, percent: formatPercent };

/** Reserve final width and accessible value; only the decorative copy counts. */
export function AnimatedNumber({ value, kind = "money" }: { value: number; kind?: keyof typeof formats }) {
  const root = useRef<HTMLSpanElement>(null);
  const visual = useRef<HTMLSpanElement>(null);
  const seen = useRef<string | null>(null);
  const text = formats[kind](value);
  useLayoutEffect(() => {
    const element = root.current, output = visual.current;
    if (!element || !output) return;
    const key = `${kind}:${value}`;
    if (seen.current === key || !Number.isFinite(value)) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduce.matches) return;
    let frame = 0, start: number | null = null, complete = false;
    const finish = () => { cancelAnimationFrame(frame); output.textContent = text; };
    const tick = (now: number) => {
      start ??= now;
      const progress = Math.min(1, (now - start) / 900);
      const raw = value * (1 - Math.pow(1 - progress, 3));
      const current = kind === "count" || Number.isInteger(value) ? Math.round(raw) : Math.round(raw * 100) / 100;
      output.textContent = progress === 1 ? text : formats[kind](current);
      if (progress < 1) frame = requestAnimationFrame(tick);
      else complete = true;
    };
    const run = () => { if (reduce.matches) { finish(); return; } seen.current = key; output.textContent = formats[kind](0); frame = requestAnimationFrame(tick); };
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting && entry.intersectionRatio >= .5)) { observer.disconnect(); run(); }
    }, { threshold: .5, rootMargin: "-64px 0px -12% 0px" });
    output.textContent = formats[kind](0);
    observer.observe(element);
    reduce.addEventListener("change", finish);
    return () => {
      observer.disconnect(); reduce.removeEventListener("change", finish); finish();
      // React's development effect rehearsal must not cancel the only entrance.
      if (!complete && seen.current === key) seen.current = null;
    };
  }, [value, kind, text]);
  return <span ref={root} className="inline-grid whitespace-nowrap align-baseline tf-num">
    <span aria-hidden="true" className="invisible col-start-1 row-start-1">{text}</span>
    <span ref={visual} aria-hidden="true" className="col-start-1 row-start-1">{text}</span>
    <span className="sr-only">{text}</span>
  </span>;
}
