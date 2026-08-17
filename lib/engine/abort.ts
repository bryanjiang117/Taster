export function abortError(message = "This operation was aborted"): DOMException {
  return new DOMException(message, "AbortError");
}

export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String(error.name) : "";
  return name === "AbortError" || name === "ResponseAborted";
}

export function rethrowIfAborted(error: unknown): void {
  if (isAbortError(error)) throw error;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw abortError();
}

export function abortable<T>(
  signal: AbortSignal | undefined,
  work: Promise<T>,
): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) {
    return Promise.reject(
      signal.reason instanceof Error ? signal.reason : abortError(),
    );
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      reject(signal.reason instanceof Error ? signal.reason : abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}
