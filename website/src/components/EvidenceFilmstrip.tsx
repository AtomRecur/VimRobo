import { memo, useEffect, useMemo, useRef, useState } from "react";
import selections from "../data/evidenceFilmstrip.json";
import type { ResearchCase } from "../data/caseTypes";
import { useReducedMotion, useVisibility } from "../hooks";
import "./EvidenceFilmstrip.css";

const wrap = (offset: number, width: number) => width > 0 ? ((offset % width) + width) % width : 0;

function EvidenceFilmstrip({ record }: { record: ResearchCase }) {
  const frames = useMemo(() => (selections.cases.find(item => item.caseId === record.id)?.frames ?? [])
    .flatMap(item => {
      const evidence = record.evidence.find(frame => frame.id === item.evidenceId);
      return evidence ? [{ ...evidence, description: item.description }] : [];
    }), [record]);
  const { ref, everVisible } = useVisibility<HTMLElement>("640px 0px");
  const { ref: viewport, visible } = useVisibility<HTMLDivElement>("0px");
  const firstGroup = useRef<HTMLDivElement>(null);
  const groupWidth = useRef(0);
  const scrollOffset = useRef(0);
  const drag = useRef<{ id: number; x: number; offset: number } | null>(null);
  const resumeTimer = useRef<number | null>(null);
  const [loaded, setLoaded] = useState<Set<string>>(() => new Set());
  const [interacting, setInteracting] = useState(false);
  const [touching, setTouching] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [pageVisible, setPageVisible] = useState(() => !document.hidden);
  const reduced = useReducedMotion();
  const running = visible && pageVisible && !interacting && !touching && !hovered && !focused && !dragging && !reduced;

  const pauseForInteraction = () => {
    if (resumeTimer.current !== null) window.clearTimeout(resumeTimer.current);
    setInteracting(true);
    resumeTimer.current = window.setTimeout(() => {
      resumeTimer.current = null;
      setInteracting(false);
    }, 500);
  };
  const finishDrag = () => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    pauseForInteraction();
  };

  useEffect(() => () => {
    if (resumeTimer.current !== null) window.clearTimeout(resumeTimer.current);
  }, []);

  useEffect(() => {
    const update = () => setPageVisible(!document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  useEffect(() => {
    const group = firstGroup.current, view = viewport.current;
    if (!group || !view) return;
    const measure = () => {
      const phase = groupWidth.current ? wrap(view.scrollLeft, groupWidth.current) / groupWidth.current : 0;
      groupWidth.current = group.getBoundingClientRect().width;
      scrollOffset.current = phase * groupWidth.current;
      view.scrollLeft = scrollOffset.current;
    };
    const observer = new ResizeObserver(measure);
    observer.observe(group);
    measure();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const view = viewport.current;
    if (!everVisible || !view) return;
    const observer = new IntersectionObserver(entries => {
      const ids = entries.filter(entry => entry.isIntersecting).map(entry => {
        observer.unobserve(entry.target);
        return (entry.target as HTMLElement).dataset.evidenceId!;
      });
      if (ids.length) setLoaded(previous => {
        if (ids.every(id => previous.has(id))) return previous;
        return new Set([...previous, ...ids]);
      });
    }, { root: view, rootMargin: "0px 300px" });
    view.querySelectorAll<HTMLElement>("[data-evidence-id]").forEach(card => observer.observe(card));
    return () => observer.disconnect();
  }, [everVisible]);

  useEffect(() => {
    if (!running) return;
    scrollOffset.current = viewport.current?.scrollLeft ?? 0;
    let frame = 0, previous = performance.now();
    const tick = (now: number) => {
      const view = viewport.current;
      if (view && groupWidth.current) {
        scrollOffset.current = wrap(scrollOffset.current + Math.min(now - previous, 64) * .038, groupWidth.current);
        view.scrollLeft = scrollOffset.current;
      }
      previous = now;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running]);

  const step = (direction: number) => {
    const view = viewport.current, group = firstGroup.current;
    if (!view || !group || !groupWidth.current) return;
    const distance = groupWidth.current / frames.length;
    let origin = wrap(view.scrollLeft, groupWidth.current);
    if (direction < 0 && origin < distance) origin += groupWidth.current;
    view.scrollLeft = origin;
    view.scrollTo({ left: origin + direction * distance, behavior: reduced ? "instant" : "smooth" });
  };

  return <section className="evidence-filmstrip" ref={ref} aria-label={`Case ${record.id} recorded evidence`} data-running={running}
    onPointerEnter={event => { if (event.pointerType === "mouse") setHovered(true); }} onPointerLeave={() => setHovered(false)}>
    <div className="filmstrip-toolbar">
      <span className="filmstrip-heading"><i/> Recorded frames <small>{String(frames.length).padStart(2, "0")}</small></span>
    </div>
    <div className="filmstrip-viewport" ref={viewport} role="region" aria-label="Recorded frames; use arrow keys to browse" tabIndex={0} data-dragging={dragging}
      onFocus={event => setFocused(event.currentTarget.matches(":focus-visible"))} onBlur={() => setFocused(false)}
      onWheel={pauseForInteraction}
      onScroll={() => { if (resumeTimer.current !== null) pauseForInteraction(); }}
      onTouchStart={() => { setTouching(true); setFocused(false); pauseForInteraction(); }}
      onTouchEnd={event => { if (!event.touches.length) { setTouching(false); pauseForInteraction(); } }}
      onTouchCancel={() => { setTouching(false); pauseForInteraction(); }}
      onKeyDown={event => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); setFocused(true); step(event.key === "ArrowRight" ? 1 : -1); }
        if (event.key === "Home") { event.preventDefault(); setFocused(true); if (viewport.current) viewport.current.scrollLeft = 0; }
      }}
      onPointerDown={event => {
        if (event.pointerType !== "mouse" || event.button !== 0) return;
        setFocused(false);
        drag.current = { id: event.pointerId, x: event.clientX, offset: event.currentTarget.scrollLeft };
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
      }}
      onPointerMove={event => {
        if (drag.current?.id === event.pointerId) event.currentTarget.scrollLeft = wrap(drag.current.offset + drag.current.x - event.clientX, groupWidth.current);
      }}
      onPointerUp={event => { finishDrag(); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
      onPointerCancel={finishDrag} onLostPointerCapture={finishDrag}>
      <div className="filmstrip-track">
        {[0, 1].map(copy => <div key={copy} className="filmstrip-group" ref={copy === 0 ? firstGroup : undefined} role={copy === 0 ? "list" : undefined} aria-hidden={copy === 1 ? true : undefined}>
          {frames.map((frame, index) => <figure key={frame.id} className="filmstrip-frame" role={copy === 0 ? "listitem" : undefined} data-evidence-id={frame.id}>
            <div className="filmstrip-image">
              {loaded.has(frame.id) && <img src={`cases/filmstrip-v2/${frame.id}.jpg`}
                srcSet={`cases/filmstrip-v2/${frame.id}.jpg 320w, cases/filmstrip-v2/${frame.id}-400.jpg 400w`}
                sizes="(max-width: 420px) 220px, (max-width: 760px) 236px, 260px" width={320} height={268}
                loading="eager" decoding="async" draggable={false} alt={copy === 0 ? frame.description : ""}/>}
            </div>
            <figcaption><div className="filmstrip-frame-meta"><time>{frame.timestamp}</time><span>{String(index + 1).padStart(2, "0")}</span></div><span className="filmstrip-description">{frame.description}</span></figcaption>
          </figure>)}
        </div>)}
      </div>
    </div>
  </section>;
}

export default memo(EvidenceFilmstrip);
