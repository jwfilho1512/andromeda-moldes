import { useEffect, useRef } from 'react';
import { type MarkerItem, type MarkerPlacement, type Vec2, bboxOfPoints, placedPolygon, shapeOf } from '@cad-textil/core';
import { type View, pointInPolygon, toScreen, toWorld } from '../editor/render';
import { editor, viewInfo } from '../editor/store';
import { movePlacement, placedOf, printsOfPlacement, riscoItems, riscoStats, risco, rotateSelected, unplaceSelected, docSizes } from './state';
import { drawPrints, onArtLoaded } from '../estampa/images';

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && !!t.closest('input, textarea, select');

/** Cor por tamanho (mesma rampa do ninho de gradação). */
function colorFor(size: string, sizes: string[], alpha: number) {
  const i = Math.max(0, sizes.indexOf(size));
  const t = sizes.length > 1 ? i / (sizes.length - 1) : 0.5;
  const hue = 220 - t * 220;
  return `hsla(${hue}, 70%, 52%, ${alpha})`;
}

/** Bandeja: moldes fora do risco, em fila abaixo do tecido. */
function trayLayout(items: MarkerItem[], placed: Set<string>, widthFabric: number): { item: MarkerItem; at: Vec2; poly: Vec2[] }[] {
  const out: { item: MarkerItem; at: Vec2; poly: Vec2[] }[] = [];
  let x = 0;
  const y0 = -150;
  for (const it of items) {
    if (placed.has(it.key)) continue;
    const { poly, w, h } = shapeOf(it, 0);
    const at = { x, y: y0 - h };
    out.push({ item: it, at, poly: poly.map((p) => ({ x: p.x + at.x, y: p.y + at.y })) });
    x += w + 40;
  }
  void widthFabric;
  return out;
}

export function RiscoCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    const view: View = { cx: 1500, cy: 700, z: 0.3, w: 0, h: 0 };
    let frame = 0;
    let fitted = false;
    let drag:
      | { kind: 'pan'; sx: number; sy: number; cx: number; cy: number }
      | { kind: 'piece'; key: string; start: Vec2; ox: number; oy: number; fromTray: boolean }
      | null = null;
    let ghost: { key: string; at: Vec2 } | null = null;
    let spaceDown = false;

    const fit = () => {
      const st = risco.get();
      const { stats } = riscoStats();
      const L = Math.max(stats.lengthMm, 1500);
      view.z = Math.min((view.w - 60) / (L + 200), (view.h - 60) / (st.fabric.widthMm + 900));
      view.cx = L / 2;
      view.cy = st.fabric.widthMm / 2 - 300;
      invalidate();
    };

    const draw = () => {
      frame = 0;
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const st = risco.get();
      const dark = editor.get().theme === 'escuro-total';
      ctx.fillStyle = dark ? '#16181c' : '#e9e9e6';
      ctx.fillRect(0, 0, view.w, view.h);
      const { items, stats, overlaps } = riscoStats();
      const byKey = new Map(items.map((i) => [i.key, i]));
      const sizes = docSizes(editor.get().doc.pieces);
      const W = st.fabric.widthMm;
      const L = Math.max(stats.lengthMm, 500);

      // Tecido
      const a = toScreen(view, { x: 0, y: W }), b = toScreen(view, { x: L + 400, y: 0 });
      ctx.fillStyle = dark ? '#22252b' : '#fbfaf6';
      ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
      // margens da ourela
      ctx.fillStyle = dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)';
      const m = st.fabric.edgeMarginMm;
      for (const [y0, y1] of [[0, m], [W - m, W]] as [number, number][]) {
        const p = toScreen(view, { x: 0, y: y1 }), q = toScreen(view, { x: L + 400, y: y0 });
        ctx.fillRect(p.x, p.y, q.x - p.x, q.y - p.y);
      }
      // régua: marcas a cada 10 cm, números a cada metro
      ctx.strokeStyle = dark ? '#3a3f47' : '#d6d3c9';
      ctx.fillStyle = dark ? '#8b919c' : '#6b7280';
      ctx.font = '11px -apple-system, system-ui, sans-serif';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= L + 400; x += 100) {
        const s = toScreen(view, { x, y: W });
        const e = toScreen(view, { x, y: 0 });
        if (x % 1000 === 0) {
          ctx.moveTo(s.x, s.y);
          ctx.lineTo(e.x, e.y);
          ctx.fillText(`${x / 1000} m`, s.x + 3, s.y - 5);
        } else {
          ctx.moveTo(s.x, s.y);
          ctx.lineTo(s.x, s.y + 6);
        }
      }
      ctx.stroke();
      // fim do risco
      const endTop = toScreen(view, { x: stats.lengthMm, y: W + 40 }), endBot = toScreen(view, { x: stats.lengthMm, y: -40 });
      ctx.strokeStyle = '#ea580c';
      ctx.setLineDash([8, 5]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(endTop.x, endTop.y);
      ctx.lineTo(endBot.x, endBot.y);
      ctx.stroke();
      ctx.setLineDash([]);
      // borda do tecido
      ctx.strokeStyle = dark ? '#8b919c' : '#1f2328';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      // cotas: largura (à esquerda) e comprimento do risco (embaixo)
      const fmtM = (mm: number) => `${(mm / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} m`;
      ctx.fillStyle = dark ? '#e6e8eb' : '#1f2328';
      ctx.font = '600 13px -apple-system, system-ui, sans-serif';
      ctx.save();
      const lp = toScreen(view, { x: 0, y: W / 2 });
      ctx.translate(lp.x - 10, lp.y);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.fillText(`Largura ${fmtM(W)}`, 0, 0);
      ctx.restore();
      if (stats.lengthMm > 0) {
        const e0 = toScreen(view, { x: 0, y: -25 }), e1 = toScreen(view, { x: stats.lengthMm, y: -25 });
        ctx.strokeStyle = '#ea580c';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(e0.x, e0.y);
        ctx.lineTo(e1.x, e1.y);
        ctx.stroke();
        ctx.fillStyle = '#ea580c';
        ctx.textAlign = 'center';
        ctx.fillText(`Comprimento do risco ${fmtM(stats.lengthMm)}`, (e0.x + e1.x) / 2, e0.y + 16);
        ctx.textAlign = 'start';
      }
      // limite de comprimento (mesa)
      const maxL = st.fabric.maxLengthMm ?? 0;
      if (maxL > 0) {
        const t = toScreen(view, { x: maxL, y: W + 60 }), u = toScreen(view, { x: maxL, y: -60 });
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(t.x, t.y);
        ctx.lineTo(u.x, u.y);
        ctx.stroke();
        ctx.fillStyle = '#ef4444';
        ctx.fillText(`Máx. ${fmtM(maxL)}`, t.x + 4, t.y + 12);
      }

      const polyPath = (pts: Vec2[]) => {
        ctx.beginPath();
        pts.forEach((p, i) => {
          const s = toScreen(view, p);
          if (i === 0) ctx.moveTo(s.x, s.y);
          else ctx.lineTo(s.x, s.y);
        });
        ctx.closePath();
      };
      const label = (it: MarkerItem, pts: Vec2[]) => {
        const bb = bboxOfPoints(pts);
        if ((bb.maxX - bb.minX) * view.z < 40) return;
        const c = toScreen(view, { x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2 });
        ctx.fillStyle = dark ? '#e6e8eb' : '#1f2328';
        ctx.font = `600 ${Math.max(10, Math.min(14, (bb.maxX - bb.minX) * view.z * 0.06))}px -apple-system, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(`${it.size ? it.size + ' · ' : ''}${it.name}${it.mirror ? ' (esp.)' : ''}`, c.x, c.y);
        ctx.textAlign = 'start';
      };

      // Moldes posicionados (com as artes das estampas por baixo dos contornos)
      const arts = new Map((editor.get().doc.artworks ?? []).map((a) => [a.id, a]));
      const withArt = new Set<string>();
      for (const pl of st.placements) {
        const it = byKey.get(pl.key);
        if (!it) continue;
        const pts = placedOf(it, pl, st.fabric).poly;
        const inst = st.sublim.showArt && arts.size ? printsOfPlacement(pl) : [];
        if (inst.length) {
          withArt.add(pl.key);
          drawPrints(ctx, inst, arts, (q) => toScreen(view, q), view);
          continue;
        }
        polyPath(pts);
        ctx.fillStyle = overlaps.has(pl.key) ? 'rgba(239,68,68,0.35)' : colorFor(it.size, sizes, 0.28);
        ctx.fill();
      }
      for (const pl of st.placements) {
        const it = byKey.get(pl.key);
        if (!it) continue;
        const pts = placedOf(it, pl, st.fabric).poly;
        polyPath(pts);
        const bad = overlaps.has(pl.key);
        if (bad && withArt.has(pl.key)) {
          ctx.fillStyle = 'rgba(239,68,68,0.35)';
          ctx.fill();
        }
        ctx.strokeStyle = bad ? '#ef4444' : pl.key === st.selected ? '#2563eb' : colorFor(it.size, sizes, 1);
        ctx.lineWidth = pl.key === st.selected ? 2.5 : 1.2;
        ctx.stroke();
        if (!withArt.has(pl.key)) label(it, pts);
      }

      // Bandeja (fora do risco)
      const tray = trayLayout(items, new Set(st.placements.map((p) => p.key)), W);
      if (tray.length) {
        const t = toScreen(view, { x: 0, y: -60 });
        ctx.fillStyle = '#ef4444';
        ctx.font = '600 13px -apple-system, system-ui, sans-serif';
        ctx.fillText(`Fora do risco: ${tray.length} molde(s) — arraste para o tecido ou use "Encaixar restantes"`, t.x, t.y);
      }
      for (const tr of tray) {
        if (ghost?.key === tr.item.key) continue;
        polyPath(tr.poly);
        ctx.fillStyle = colorFor(tr.item.size, sizes, 0.15);
        ctx.fill();
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = colorFor(tr.item.size, sizes, 1);
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.setLineDash([]);
        label(tr.item, tr.poly);
      }
      if (ghost) {
        const it = byKey.get(ghost.key);
        if (it) {
          const { poly } = shapeOf(it, 0);
          const pts = poly.map((p) => ({ x: p.x + ghost!.at.x, y: p.y + ghost!.at.y }));
          polyPath(pts);
          ctx.fillStyle = colorFor(it.size, sizes, 0.35);
          ctx.fill();
          ctx.strokeStyle = '#2563eb';
          ctx.stroke();
        }
      }
    };
    const invalidate = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };

    const ro = new ResizeObserver(() => {
      const r = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      view.w = r.width;
      view.h = r.height;
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      if (!fitted && r.width > 0) {
        fitted = true;
        fit();
      }
      draw();
    });
    ro.observe(canvas);

    const local = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const hitPlacement = (w: Vec2): MarkerPlacement | null => {
      const st = risco.get();
      const byKey = new Map(riscoItems().map((i) => [i.key, i]));
      for (const pl of [...st.placements].reverse()) {
        const it = byKey.get(pl.key);
        if (it && pointInPolygon(w, placedOf(it, pl, st.fabric).poly)) return pl;
      }
      return null;
    };
    const hitTray = (w: Vec2) => {
      const st = risco.get();
      return trayLayout(riscoItems(), new Set(st.placements.map((p) => p.key)), st.fabric.widthMm).find((t) => pointInPolygon(w, t.poly)) ?? null;
    };

    const onDown = (e: PointerEvent) => {
      canvas.focus();
      const sp = local(e);
      const w = toWorld(view, sp.x, sp.y);
      if (risco.get().running) return;
      if (e.button === 1 || spaceDown) {
        drag = { kind: 'pan', sx: sp.x, sy: sp.y, cx: view.cx, cy: view.cy };
      } else if (e.button === 0) {
        const pl = hitPlacement(w);
        if (pl) {
          risco.set({ selected: pl.key });
          drag = { kind: 'piece', key: pl.key, start: w, ox: pl.x, oy: pl.y, fromTray: false };
        } else {
          const tr = hitTray(w);
          if (tr) {
            risco.set({ selected: tr.item.key });
            drag = { kind: 'piece', key: tr.item.key, start: w, ox: tr.at.x, oy: tr.at.y, fromTray: true };
            ghost = { key: tr.item.key, at: tr.at };
          } else {
            risco.set({ selected: null });
            drag = { kind: 'pan', sx: sp.x, sy: sp.y, cx: view.cx, cy: view.cy };
          }
        }
      }
      canvas.setPointerCapture(e.pointerId);
      invalidate();
    };

    const onMove = (e: PointerEvent) => {
      const sp = local(e);
      const w = toWorld(view, sp.x, sp.y);
      viewInfo.set({ cursor: { x: w.x, y: w.y } });
      if (!drag) return;
      if (drag.kind === 'pan') {
        view.cx = drag.cx - (sp.x - drag.sx) / view.z;
        view.cy = drag.cy + (sp.y - drag.sy) / view.z;
      } else {
        const x = Math.round(drag.ox + w.x - drag.start.x);
        const y = Math.round(drag.oy + w.y - drag.start.y);
        if (drag.fromTray) ghost = { key: drag.key, at: { x, y } };
        else movePlacement(drag.key, x, y, false);
      }
      invalidate();
    };

    const onUp = (e: PointerEvent) => {
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      const d = drag;
      drag = null;
      if (d?.kind === 'piece') {
        const st = risco.get();
        if (d.fromTray && ghost) {
          // Soltou sobre o tecido: entra no risco
          if (ghost.at.y > -50) {
            const y = Math.max(0, ghost.at.y - st.fabric.edgeMarginMm);
            risco.set({ placements: [...st.placements, { key: d.key, x: Math.max(0, ghost.at.x), y, rot: 0 }] });
            movePlacement(d.key, Math.max(0, ghost.at.x), y, true);
          }
          ghost = null;
        } else {
          const pl = st.placements.find((p) => p.key === d.key);
          if (pl) movePlacement(d.key, pl.x, pl.y, true);
        }
      }
      invalidate();
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const sp = local(e);
      const before = toWorld(view, sp.x, sp.y);
      view.z = Math.min(20, Math.max(0.01, view.z * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))));
      const after = toWorld(view, sp.x, sp.y);
      view.cx += before.x - after.x;
      view.cy += before.y - after.y;
      invalidate();
    };

    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || editor.get().workspace !== 'risco') return;
      if (e.code === 'Space') {
        spaceDown = e.type === 'keydown';
        e.preventDefault();
        return;
      }
      if (e.type !== 'keydown') return;
      const st = risco.get();
      const sel = st.placements.find((p) => p.key === st.selected);
      const step = e.shiftKey ? 10 : 1;
      switch (e.key) {
        case 'r': case 'R': rotateSelected(); break;
        case 'Delete': case 'Backspace': unplaceSelected(); e.preventDefault(); break;
        case 'ArrowLeft': if (sel) movePlacement(sel.key, sel.x - step, sel.y, true); e.preventDefault(); break;
        case 'ArrowRight': if (sel) movePlacement(sel.key, sel.x + step, sel.y, true); e.preventDefault(); break;
        case 'ArrowUp': if (sel) movePlacement(sel.key, sel.x, sel.y + step, true); e.preventDefault(); break;
        case 'ArrowDown': if (sel) movePlacement(sel.key, sel.x, sel.y - step, true); e.preventDefault(); break;
        case '0': if (e.metaKey || e.ctrlKey) { fit(); e.preventDefault(); } break;
      }
      invalidate();
    };

    const unsubs = [risco.subscribe(invalidate), editor.subscribe(invalidate), onArtLoaded(invalidate)];
    riscoView.fit = fit;
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      ro.disconnect();
      unsubs.forEach((u) => u());
      cancelAnimationFrame(frame);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, []);

  return <canvas ref={ref} className="canvas" tabIndex={0} />;
}

export const riscoView = { fit: () => {} };
