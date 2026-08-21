"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ScoreContribution, ScoreContributions } from "@/lib/engine/combine";
import { TASTE_DIMENSIONS, type TasteProfile } from "@/lib/engine/taste";

function coarsePointer(): boolean {
  return window.matchMedia("(pointer: coarse)").matches;
}

export function ScoreList({
  taste,
  contributions,
}: {
  taste: TasteProfile;
  contributions?: ScoreContributions;
}) {
  const [open, setOpen] = useState<(typeof TASTE_DIMENSIONS)[number] | null>(
    null,
  );
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const hideTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Element | null;
      if (!target) return;
      if (target.closest(".ing-tip") || target.closest(".score-row")) return;
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

  function show(dim: (typeof TASTE_DIMENSIONS)[number], rect: DOMRect) {
    cancelHide();
    setOpen(dim);
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

  return (
    <>
      <ol className="scores">
        {TASTE_DIMENSIONS.map((dim) => (
          <li
            key={dim}
            className="score-row"
            tabIndex={0}
            aria-expanded={open === dim}
            onMouseEnter={(event) => {
              if (coarsePointer()) return;
              show(dim, event.currentTarget.getBoundingClientRect());
            }}
            onMouseLeave={() => {
              if (coarsePointer()) return;
              scheduleHide();
            }}
            onFocus={(event) => {
              if (coarsePointer()) return;
              show(dim, event.currentTarget.getBoundingClientRect());
            }}
            onBlur={() => {
              if (coarsePointer()) return;
              scheduleHide();
            }}
            onClick={(event) => {
              if (!coarsePointer()) return;
              const rect = event.currentTarget.getBoundingClientRect();
              if (open === dim) hideNow();
              else show(dim, rect);
            }}
          >
            <span className="score-dim">{label(dim)}</span>
            <b>
              {formatScore(taste[dim])}
              <small>/10</small>
            </b>
          </li>
        ))}
      </ol>
      {open && anchor ? (
        <ScoreTip
          dim={open}
          score={taste[open]}
          rows={contributions?.[open] ?? []}
          anchor={anchor}
          onEnter={cancelHide}
          onLeave={scheduleHide}
        />
      ) : null}
    </>
  );
}

function ScoreTip({
  dim,
  score,
  rows,
  anchor,
  onEnter,
  onLeave,
}: {
  dim: (typeof TASTE_DIMENSIONS)[number];
  score: number;
  rows: ScoreContribution[];
  anchor: DOMRect;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const id = useId();
  const tipRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [pos, setPos] = useState({
    top: anchor.top,
    left: Math.max(8, anchor.left - 12),
  });
  const empty = rows.length === 0 || score <= 0;
  const canExpand = rows.length > SCORE_TIP_PREVIEW;
  const visible =
    expanded || !canExpand ? rows : rows.slice(0, SCORE_TIP_PREVIEW);
  const hiddenCount = rows.length - SCORE_TIP_PREVIEW;

  useEffect(() => {
    setExpanded(false);
  }, [dim]);

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
  }, [anchor, dim, rows.length, empty, expanded]);

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
      <strong>
        {label(dim)} {formatScore(score)}
        <small>/10</small>
      </strong>
      {empty ? (
        score <= 0 ? (
          <p>No ingredients contributed — this score is 0.</p>
        ) : (
          <p>No ingredient breakdown available.</p>
        )
      ) : (
        <>
          <dl className="score-tip-contributors">
            {visible.map((row) => (
              <div key={row.name}>
                <dt>{row.name}</dt>
                <dd>+{formatPoints(row.points)}</dd>
              </div>
            ))}
          </dl>
          {canExpand ? (
            <button
              type="button"
              className="score-tip-more"
              onClick={(event) => {
                event.stopPropagation();
                setExpanded((current) => !current);
              }}
            >
              {expanded ? "Show less" : `Show more (${hiddenCount})`}
            </button>
          ) : null}
        </>
      )}
    </div>,
    document.body,
  );
}

const SCORE_TIP_PREVIEW = 5;

function label(dim: string): string {
  return dim.charAt(0).toUpperCase() + dim.slice(1);
}

function formatScore(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatPoints(value: number): string {
  if (Number.isInteger(value)) return String(value);
  if (Math.abs(value) > 0 && Math.abs(value) < 1) return value.toFixed(2);
  return value.toFixed(1);
}
