import { abortable, throwIfAborted } from "./abort";
import type { FoundIngredient } from "./found-ingredients";

export type ProgressStepEvent = {
  type: "step";
  id: string;
  message: string;
  status: "running" | "done";
  durationMs?: number;
};

export type ProgressDoneEvent = {
  type: "done";
  totalMs: number;
  result: unknown;
};

export type ProgressErrorEvent = {
  type: "error";
  error: string;
  totalMs: number;
};

export type ProgressIngredientEvent = {
  type: "ingredients";
  items: FoundIngredient[];
};

export type ProgressEvent =
  | ProgressStepEvent
  | ProgressIngredientEvent
  | ProgressDoneEvent
  | ProgressErrorEvent;

export type ProgressSink = (event: ProgressEvent) => void;

export async function runLoggedStep<T>(
  emit: ProgressSink | undefined,
  id: string,
  message: string,
  fn: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  emit?.({ type: "step", id, message, status: "running" });
  const started = Date.now();
  try {
    throwIfAborted(signal);
    const result = await abortable(signal, fn());
    emit?.({
      type: "step",
      id,
      message,
      status: "done",
      durationMs: Date.now() - started,
    });
    return result;
  } catch (error) {
    emit?.({
      type: "step",
      id,
      message,
      status: "done",
      durationMs: Date.now() - started,
    });
    throw error;
  }
}
