/** CSS-pixel size of the page viewport at screenshot time. */
export type BrowserViewportSize = { width: number; height: number };

/** Upper bound for the post-capture viewport read. */
export const VIEWPORT_MEASURE_TIMEOUT_MS = 1_500;

function toPositiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  const rounded = Math.round(value);
  return rounded >= 1 ? rounded : undefined;
}

/** Returns a viewport size only when both sides are positive integers. */
export function toBrowserViewportSize(value: unknown): BrowserViewportSize | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const { width, height } = value as { width?: unknown; height?: unknown };
  const w = toPositiveInteger(width);
  const h = toPositiveInteger(height);
  return w && h ? { width: w, height: h } : undefined;
}

/** Reads the viewport best-effort; returns undefined on failure, invalid data, or timeout. */
export async function measureBrowserViewport(
  read: () => Promise<unknown>,
  timeoutMs = VIEWPORT_MEASURE_TIMEOUT_MS,
): Promise<BrowserViewportSize | undefined> {
  // Runs after a successful capture, so it must never delay or fail that capture.
  const reading = Promise.resolve()
    .then(read)
    .then(toBrowserViewportSize)
    .catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), timeoutMs);
  });
  try {
    return await Promise.race([reading, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}
