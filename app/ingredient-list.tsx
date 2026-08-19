"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TASTE_DIMENSIONS, type TasteProfile } from "@/lib/engine/taste";
import type { FoundIngredient } from "@/lib/engine/found-ingredients";
import { formatIngredientProvenance } from "@/lib/ui/ingredient-provenance";

function coarsePointer(): boolean {
  return window.matchMedia("(pointer: coarse)").matches;
}

export function IngredientList({ items }: { items: FoundIngredient[] }) {
  const [open, setOpen] = useState<FoundIngredient | null>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [fadeBottom, setFadeBottom] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const hideTimer = useRef<number | null>(null);

  useEffect(() => {
    const node = listRef.current;
    if (!node) return;
    const list: HTMLUListElement = node;

    const updateFade = () => {
      const leftover = list.scrollHeight - list.scrollTop - list.clientHeight;
      setFadeBottom(leftover > 2);
    };

    updateFade();
    const observer = new ResizeObserver(updateFade);
    observer.observe(list);
    list.addEventListener("scroll", updateFade, { passive: true });
    return () => {
      observer.disconnect();
      list.removeEventListener("scroll", updateFade);
    };
  }, [items]);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Element | null;
      if (!target) return;
      if (target.closest(".ing-tip") || target.closest(".ing-name")) return;
      cancelHide();
      setOpen(null);
      setAnchor(null);
    }

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function cancelHide() {
    if (hideTimer.current == null) return;
    window.clearTimeout(hideTimer.current);
    hideTimer.current = null;
  }

  function show(item: FoundIngredient, rect: DOMRect) {
    cancelHide();
    setOpen(item);
    setAnchor(rect);
  }

  function hideNow() {
    cancelHide();
    setOpen(null);
    setAnchor(null);
  }

  function scheduleHide() {
    cancelHide();
    hideTimer.current = window.setTimeout(() => {
      setOpen(null);
      setAnchor(null);
    }, 200);
  }

  if (items.length === 0) return null;

  return (
    <section className="ings" aria-label="Ingredients found in recipes">
      <p className="ings-label">Ingredients</p>
      <div className="ings-scroller" data-fade-bottom={fadeBottom}>
        <ul ref={listRef}>
          {items.map((row) => (
            <li key={row.name} data-out={row.out || undefined}>
              <span
                className="ing-name"
                tabIndex={0}
                aria-expanded={open?.name === row.name}
                onMouseEnter={(event) => {
                  if (coarsePointer()) return;
                  show(row, event.currentTarget.getBoundingClientRect());
                }}
                onMouseLeave={() => {
                  if (coarsePointer()) return;
                  scheduleHide();
                }}
                onFocus={(event) => {
                  if (coarsePointer()) return;
                  show(row, event.currentTarget.getBoundingClientRect());
                }}
                onBlur={() => {
                  if (coarsePointer()) return;
                  scheduleHide();
                }}
                onClick={(event) => {
                  if (!coarsePointer()) return;
                  const rect = event.currentTarget.getBoundingClientRect();
                  if (open?.name === row.name) hideNow();
                  else show(row, rect);
                }}
              >
                {row.name}
              </span>
              <span className="ing-flavors">
                {row.pending
                  ? "tasting…"
                  : row.flavors.length
                    ? row.flavors.join(" · ")
                    : "neutral"}
              </span>
              <span className="ing-count">
                {row.out
                  ? "on the side"
                  : `in ${row.used}/${row.total} recipes`}
              </span>
            </li>
          ))}
        </ul>
      </div>
      {open && anchor ? (
        <IngredientTip
          item={open}
          anchor={anchor}
          onEnter={cancelHide}
          onLeave={scheduleHide}
        />
      ) : null}
    </section>
  );
}

function IngredientTip({
  item,
  anchor,
  onEnter,
  onLeave,
}: {
  item: FoundIngredient;
  anchor: DOMRect;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const id = useId();
  const tipRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({
    top: anchor.top,
    left: Math.max(8, anchor.left - 12),
  });

  useEffect(() => {
    const el = tipRef.current;
    if (!el) return;
    const tip = el.getBoundingClientRect();
    const pad = 8;
    const gap = 10;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = anchor.left - tip.width - gap;
    let top = anchor.top;

    if (left < pad) {
      left = Math.min(Math.max(pad, anchor.left), vw - tip.width - pad);
      top = anchor.bottom + gap;
      if (top + tip.height > vh - pad) {
        top = Math.max(pad, anchor.top - tip.height - gap);
      }
    } else if (top + tip.height > vh - pad) {
      top = Math.max(pad, vh - tip.height - pad);
    }

    left = Math.min(Math.max(pad, left), Math.max(pad, vw - tip.width - pad));
    setPos({ top, left });
  }, [anchor, item.name, item.recipes.length]);

  const provenance = formatIngredientProvenance(item);

  return createPortal(
    <div
      ref={tipRef}
      id={id}
      className="ing-tip"
      role="tooltip"
      style={{ top: pos.top, left: pos.left }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <strong>{item.name}</strong>
      <p>
        {item.out
          ? `Served on the side in ${item.used} of ${item.total} recipes`
          : `Found in ${item.used} of ${item.total} recipes`}
      </p>
      {item.recipes.length ? (
        <ul className="ing-tip-recipes">
          {item.recipes.map((recipe, index) => (
            <li key={`${recipe.url}-${index}`}>
              <a href={recipe.url} target="_blank" rel="noopener noreferrer">
                {recipe.title}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {item.taste ? <TasteLines taste={item.taste} /> : <p>No profile yet.</p>}
      {item.derivedFrom?.length ? (
        <p>from {item.derivedFrom.join(", ")}</p>
      ) : null}
      {item.processing?.length ? <p>{item.processing.join(", ")}</p> : null}
      {provenance ? <p>{provenance}</p> : null}
    </div>,
    document.body,
  );
}

function TasteLines({ taste }: { taste: TasteProfile }) {
  return (
    <dl>
      {TASTE_DIMENSIONS.map((dim) => (
        <div key={dim}>
          <dt>{dim}</dt>
          <dd>{formatScore(taste[dim])}</dd>
        </div>
      ))}
    </dl>
  );
}

function formatScore(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
