// Small helpers with no knowledge of the app.

const usdFormat = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export const money = (n: number | null | undefined) => (n != null ? usdFormat.format(n) : "—");

/** "1 card", "3 cards" */
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

/** Escape text before putting it in HTML. */
export function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"]/g, (ch) => HTML_ESCAPES[ch]!);
}

/** localStorage that never throws (private mode, storage full, etc.). */
export const store = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  },
};

export function context2d(canvas: HTMLCanvasElement, options?: CanvasRenderingContext2DSettings) {
  const ctx = canvas.getContext("2d", options);
  if (!ctx) throw new Error("Canvas 2D isn't available");
  return ctx;
}

/** Runs task(0) … task(count - 1), at most `parallel` at a time. */
export async function runInParallel(count: number, parallel: number, task: (i: number) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < count) await task(next++);
  };
  await Promise.all(Array.from({ length: parallel }, worker));
}

/**
 * Collects results that finish out of order and hands them to `handle`
 * in order: result 2 waits until results 0 and 1 are in.
 */
export class InOrder<T> {
  private readonly results: (T | undefined)[] = [];
  /** How many results have been handed on. */
  handled = 0;
  /** How many results are in, handed on or not. */
  finished = 0;

  constructor(private readonly handle: (result: T, index: number) => void) {}

  set(index: number, result: T) {
    this.results[index] = result;
    this.finished++;
    for (let r = this.results[this.handled]; r !== undefined; r = this.results[this.handled]) {
      this.handle(r, this.handled++);
    }
  }
}
