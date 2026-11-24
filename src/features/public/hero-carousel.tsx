"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type Step = { n: string; title: string; body: string; role: string; icon: "share" | "accept" | "deliver" | "record" };

function StepIcon({ name }: { name: Step["icon"] }) {
  const common = { width: 56, height: 56, viewBox: "0 0 64 64", fill: "none", stroke: "currentColor", strokeWidth: 2.4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, focusable: false };
  if (name === "share") return <svg {...common}><path d="M14 30h36l-3.6 23.1a4 4 0 0 1-4 3.4H21.6a4 4 0 0 1-4-3.4L14 30Z"/><path d="M11 30h42"/><path d="M25 38v12M32 38v12M39 38v12"/><circle cx="24" cy="21" r="6.5"/><path d="M24 14.5c0-2.6 1.4-4.2 3.8-4.8"/><path d="M35 29c-.8-8 3.2-13.6 10-13.6.8 7-3 12.2-10 13.6Z"/></svg>;
  if (name === "accept") return <svg {...common}><rect x="14" y="12" width="36" height="44" rx="5"/><rect x="24" y="7" width="16" height="9" rx="3"/><path d="M23 35l6.5 6.5L42 28"/></svg>;
  if (name === "deliver") return <svg {...common}><rect x="6" y="16" width="31" height="28" rx="3"/><path d="M37 26h9.5l9.5 10.5V44H37"/><path d="M15 30l5.5 5.5L29 26"/><circle cx="19" cy="46" r="5" fill="var(--color-success)"/><circle cx="46" cy="46" r="5" fill="var(--color-success)"/></svg>;
  return <svg {...common}><rect x="13" y="8" width="38" height="48" rx="5"/><path d="M22 22h2M30 22h14M22 31h2M30 31h14M22 40h2M30 40h9"/><path d="M22 48h20"/></svg>;
}

export function HeroCarousel({ steps }: { steps: Step[] }) {
  const clones = 2;
  const all = [...steps, ...steps.slice(0, clones)];
  const [index, setIndex] = useState(0);
  const [animate, setAnimate] = useState(true);
  const [hoverPaused, setHoverPaused] = useState(false);
  const [reduce, setReduce] = useState(false);
  const [stepPx, setStepPx] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduce(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const measure = useCallback(() => {
    const track = trackRef.current;
    if (!track?.firstElementChild) return;
    const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
    setStepPx((track.firstElementChild as HTMLElement).offsetWidth + gap);
  }, []);

  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  useEffect(() => {
    function onVisibilityChange() {
      if (document.hidden) {
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        return;
      }
      measure();
      setAnimate(false);
      setIndex((i) => (i >= steps.length ? i % steps.length : i));
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [measure, steps.length]);

  const running = !hoverPaused && !reduce;

  useEffect(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (!running) return;
    timerRef.current = setInterval(() => { setAnimate(true); setIndex((i) => i + 1); }, 8000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [running]);

  useEffect(() => {
    if (!animate) {
      const id = requestAnimationFrame(() => setAnimate(true));
      return () => cancelAnimationFrame(id);
    }
  }, [animate]);

  function onTransitionEnd(e: React.TransitionEvent) {
    if (e.target !== e.currentTarget || e.propertyName !== "transform") return;
    if (index >= steps.length) { setAnimate(false); setIndex((i) => i - steps.length); }
  }

  function go(i: number) {
    if (index >= steps.length) { setAnimate(false); setIndex(index - steps.length); }
    requestAnimationFrame(() => { setAnimate(true); setIndex(i); });
  }

  const active = index % steps.length;

  return (
    <div
      className="w-full min-w-0 text-primary-foreground"
      role="group"
      aria-roledescription="carousel"
      aria-label="From surplus to service"
      onMouseEnter={() => setHoverPaused(true)}
      onMouseLeave={() => setHoverPaused(false)}
      onFocusCapture={() => setHoverPaused(true)}
      onBlurCapture={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setHoverPaused(false); }}
    >
      <p className="pr-7 text-xs font-semibold leading-[18px] tracking-[0.06em]">FROM SURPLUS TO SERVICE</p>
      <div className="mt-4 overflow-hidden">
        <div
          ref={trackRef}
          className={cn("flex gap-4", animate && !reduce ? "transition-transform duration-1000 ease-out" : "transition-none")}
          style={{ transform: `translateX(${-index * stepPx}px)` }}
          onTransitionEnd={onTransitionEnd}
          aria-live={running ? "off" : "polite"}
        >
          {all.map((s, i) => (
            <div key={`${s.n}-${i}`} className={cn("w-[80%] shrink-0 transition-opacity duration-500", i % steps.length === active ? "opacity-100" : "opacity-50")} role="group" aria-roledescription="slide" aria-label={`${(i % steps.length) + 1} of ${steps.length}`} aria-hidden={i >= steps.length}>
              <div className="flex min-h-[272px] h-full flex-col rounded-xl bg-card p-6 text-foreground">
                <div className="flex justify-center">
                  <span className="grid size-[88px] place-items-center rounded-2xl bg-success text-primary"><StepIcon name={s.icon} /></span>
                </div>
                <h3 className="mt-6 text-center text-xl font-semibold leading-7 text-balance">{s.title}</h3>
                <p className="mt-2 text-center text-sm leading-5 text-muted-foreground text-pretty">{s.body}</p>
                <span className="mt-5 inline-flex self-center rounded-full border border-border bg-success px-2.5 py-0.5 text-xs font-semibold leading-[18px] text-primary">{s.role}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-2 flex items-center pr-7">
        <div className="flex">
          {steps.map((s, i) => (
            <button key={s.n} type="button" className="grid h-11 w-9 place-items-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground" aria-label={`Show step ${i + 1} of ${steps.length}`} aria-current={i === active ? "true" : undefined} onClick={() => go(i)}>
              <span className={cn("h-2.5 rounded-full bg-primary-foreground transition-all", i === active ? "w-[26px] opacity-100" : "w-2.5 opacity-40")} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
