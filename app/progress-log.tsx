"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ProgressStepEvent } from "@/lib/engine/progress";
import { nextStartedAt } from "@/lib/ui/progress-timer";

export function ProgressLog({
  steps,
  totalMs,
  running,
}: {
  steps: ProgressStepEvent[];
  totalMs: number | null;
  running: boolean;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => Date.now());
  const startedAt = useRef<Record<string, number>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const pinRow = useRef<HTMLLIElement | null>(null);
  const pinBottom = useRef<number | null>(null);
  const expandedIdRef = useRef(expandedId);
  expandedIdRef.current = expandedId;
  startedAt.current = nextStartedAt(startedAt.current, steps, Date.now());

  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [running]);

  useEffect(() => {
    const el = scroller.current;
    if (!el || expandedIdRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [steps]);

  useLayoutEffect(() => {
    const el = scroller.current;
    const row = pinRow.current;
    const beforeBottom = pinBottom.current;
    pinRow.current = null;
    pinBottom.current = null;
    if (!el || !row || beforeBottom == null) return;
    el.scrollTop += row.getBoundingClientRect().bottom - beforeBottom;
  }, [expandedId]);

  function toggleExpanded(id: string, row: HTMLLIElement) {
    const el = scroller.current;
    const atBottom =
      el != null && el.scrollHeight - el.scrollTop - el.clientHeight <= 2;
    pinRow.current = row;
    pinBottom.current = atBottom ? row.getBoundingClientRect().bottom : null;
    setExpandedId((current) => (current === id ? null : id));
  }

  if (steps.length === 0) return null;

  return (
    <section className="log" aria-live="polite" aria-label="Pipeline log">
      <p className="log-label">Log</p>
      <div className="log-window" ref={scroller}>
        <ol>
          {steps.map((step) => {
            const open = expandedId === step.id;
            return (
              <li
                key={step.id}
                data-status={step.status}
                data-open={open ? "true" : undefined}
              >
                <button
                  type="button"
                  className="log-msg"
                  aria-expanded={open}
                  onClick={(event) => {
                    toggleExpanded(
                      step.id,
                      event.currentTarget.closest("li")!,
                    );
                  }}
                >
                  {step.message}
                </button>
                <time className="log-time">
                  {formatDuration(elapsed(step, now, startedAt.current))}
                </time>
              </li>
            );
          })}
        </ol>
      </div>
      {totalMs != null ? (
        <p className="log-total">
          Total {formatDuration(totalMs)}
          <span>
            {" "}
            · {steps.filter((s) => s.status === "done").length} steps
          </span>
        </p>
      ) : null}
    </section>
  );
}

function elapsed(
  step: ProgressStepEvent,
  now: number,
  startedAt: Record<string, number>,
): number {
  if (step.status === "done") return step.durationMs ?? 0;
  const start = startedAt[step.id] ?? now;
  return Math.max(0, now - start);
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
