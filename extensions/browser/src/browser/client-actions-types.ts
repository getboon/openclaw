/**
 * Shared result types for browser client action helpers.
 */
import type { AnnotationItem } from "./screenshot-annotate.js";
import type { BrowserViewportSize } from "./screenshot-viewport.js";

/** Generic success result for action endpoints. */
export type BrowserActionOk = { ok: true };

/** Success result carrying the affected tab and optional URL. */
export type BrowserActionTabResult = {
  ok: true;
  targetId: string;
  url?: string;
};

/** Success result carrying a filesystem output path. */
export type BrowserActionPathResult = {
  ok: true;
  path: string;
  targetId: string;
  url?: string;
  labels?: boolean;
  labelsCount?: number;
  labelsSkipped?: number;
  /**
   * Per-ref bounding boxes when labels=true. Coordinates are in the
   * captured image's space (viewport / fullpage / element-relative).
   * Omitted when empty.
   */
  annotations?: AnnotationItem[];
};

/** Screenshot result; viewport is the CSS-pixel viewport for plain viewport captures. */
export type BrowserScreenshotResult = BrowserActionPathResult & { viewport?: BrowserViewportSize };
