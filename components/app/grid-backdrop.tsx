"use client";

import { useEffect, useRef } from "react";

const CELL = 45;
const TRAIL = 6;

/**
 * Decorative background for a page header: a faint 45px grid drifting diagonally, cells under the pointer
 * light up and fade out behind it, with a blue glow top-left and a green one bottom-right.
 * Purely visual (aria-hidden, never captures the pointer); static when "reduce motion" is on.
 */
export function GridBackdrop() {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const host = wrap.current;
    const cv = canvas.current;
    const ctx = cv?.getContext("2d");
    if (!host || !cv || !ctx) return;
    const parent = host.parentElement;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0;
    let h = 0;
    let offset = 0;
    let raf = 0;
    const trail: { x: number; y: number }[] = [];
    let hover: { x: number; y: number } | null = null;

    const size = () => {
      const r = host.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      w = r.width;
      h = r.height;
      cv.width = w * dpr;
      cv.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      const o = offset % CELL;
      ctx.fillStyle = "rgba(0,63,138,0.06)";
      trail.forEach((c, i) => {
        ctx.globalAlpha = (i + 1) / (trail.length + 1);
        ctx.fillRect(c.x * CELL - o, c.y * CELL - o, CELL, CELL);
      });
      ctx.globalAlpha = 1;
      if (hover) ctx.fillRect(hover.x * CELL - o, hover.y * CELL - o, CELL, CELL);
      ctx.strokeStyle = "rgba(0,63,138,0.04)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = -o; x < w + CELL; x += CELL) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
      }
      for (let y = -o; y < h + CELL; y += CELL) {
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
      }
      ctx.stroke();
    };
    const loop = () => {
      offset += 0.4;
      draw();
      raf = requestAnimationFrame(loop);
    };
    const onMove = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      const o = offset % CELL;
      const x = Math.floor((e.clientX - r.left + o) / CELL);
      const y = Math.floor((e.clientY - r.top + o) / CELL);
      if (hover && hover.x === x && hover.y === y) return;
      if (hover) trail.push(hover);
      while (trail.length > TRAIL) trail.shift();
      hover = { x, y };
    };
    const onLeave = () => {
      if (hover) trail.push(hover);
      hover = null;
    };

    size();
    const ro = new ResizeObserver(size);
    ro.observe(host);
    if (reduce) draw();
    else {
      raf = requestAnimationFrame(loop);
      parent?.addEventListener("pointermove", onMove);
      parent?.addEventListener("pointerleave", onLeave);
    }
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      parent?.removeEventListener("pointermove", onMove);
      parent?.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <div ref={wrap} aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-xl">
      <div className="absolute -top-24 -left-24 size-80 rounded-full bg-[radial-gradient(circle,rgba(0,63,138,0.10),transparent_70%)] blur-2xl" />
      <div className="absolute -right-24 -bottom-24 size-72 rounded-full bg-[radial-gradient(circle,rgba(16,185,129,0.08),transparent_70%)] blur-2xl" />
      <canvas ref={canvas} className="absolute inset-0 size-full" />
    </div>
  );
}
