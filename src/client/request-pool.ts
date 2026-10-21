import { bindContext, contextFor, telemetryEnabled, telemetryKey } from "./telemetry";
type Entry<T> = {
  controller: AbortController;
  consumers: Set<object>;
  promise: Promise<T>;
  start: () => void;
  started: boolean;
  settled: boolean;
  expires: number;
  invalidated?: boolean;
  // Whether the first interest was speculative, and the answer it received.
  speculative: boolean;
  value?: T;
  adopted?: boolean;
};

// Retains only request metadata/results such as query IDs. Entities remain in TanStack DB.
export class RequestPool<T> {
  private entries = new Map<string, Entry<T>>();
  private running = 0;
  constructor(
    private concurrency = 3,
    private onEvent: (
      event: string,
      fields: Record<string, string | number | boolean | undefined>,
    ) => void = () => {},
  ) {}

  run(
    key: string,
    load: (signal: AbortSignal) => Promise<T>,
    options: {
      signal?: AbortSignal;
      speculative?: boolean;
      ttl?: () => number;
      // A settled answer is reusable only if it meets this consumer's requirements.
      // A route loader, for example, requires complete coverage even after a foreground read.
      fresh?: (value: T) => boolean;
    } = {},
  ): Promise<T> {
    const { signal, speculative = false, ttl = () => 30_000, fresh } = options;
    if (signal?.aborted) return Promise.reject(signal.reason);
    let entry = this.entries.get(key);
    if (entry?.settled && (entry.expires <= Date.now() || (fresh && !fresh(entry.value as T)))) {
      this.entries.delete(key);
      entry = undefined;
    }
    if (!entry) {
      const controller = new AbortController();
      if (telemetryEnabled) bindContext(controller.signal, { traceId: crypto.randomUUID() });
      const created = performance.now();
      let resolve!: (value: T) => void;
      let reject!: (reason: unknown) => void;
      const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
      });
      entry = {
        controller,
        consumers: new Set(),
        promise,
        started: false,
        settled: false,
        expires: 0,
        speculative,
        start: () => {
          if (entry!.started) return;
          entry!.started = true;
          this.running++;
          const started = performance.now();
          this.onEvent("start", {
            key,
            ...contextFor(controller.signal),
            speculative,
            queueMs: started - created,
            running: this.running,
            queued: this.queued(),
          });
          void load(controller.signal)
            .then(
              (value) => {
                entry!.settled = true;
                entry!.value = value;
                entry!.expires = entry!.invalidated ? 0 : Date.now() + ttl();
                this.onEvent("complete", {
                  key,
                  ...contextFor(controller.signal),
                  speculative,
                  adopted: entry!.adopted ?? false,
                  ms: performance.now() - started,
                });
                resolve(value);
              },
              (error: unknown) => {
                if (this.entries.get(key) === entry) this.entries.delete(key);
                this.onEvent("failed", {
                  key,
                  ...contextFor(controller.signal),
                  speculative,
                  ms: performance.now() - started,
                });
                reject(error);
              },
            )
            .finally(() => {
              this.running--;
              this.drain();
            });
        },
      };
      // Aborting a queued entry must also settle its promise.
      controller.signal.addEventListener("abort", () => reject(controller.signal.reason), {
        once: true,
      });
      this.entries.set(key, entry);
    }
    const current = entry;
    this.onEvent(current.consumers.size || current.settled ? "join" : "request", {
      key,
      speculative,
      settled: current.settled,
      ...contextFor(signal),
      workId: contextFor(current.controller.signal)?.traceId ?? telemetryKey(key) ?? "",
      adopted: current.speculative && !speculative,
    });
    if (current.speculative && !speculative) current.adopted = true;
    const consumer = {};
    current.consumers.add(consumer);
    // Navigation joins/promotes speculative work without waiting for the speculative budget.
    if (!speculative || this.running < this.concurrency) current.start();
    return new Promise<T>((resolve, reject) => {
      const release = () => {
        signal?.removeEventListener("abort", abort);
        current.consumers.delete(consumer);
        if (!current.settled && !current.consumers.size) {
          if (this.entries.get(key) === current) this.entries.delete(key);
          current.controller.abort();
          this.onEvent("cancel", { key, started: current.started });
        }
      };
      const abort = () => {
        release();
        reject(signal?.reason);
        this.drain();
      };
      signal?.addEventListener("abort", abort, { once: true });
      void current.promise.then(
        (value) => {
          release();
          resolve(value);
        },
        (error: unknown) => {
          release();
          reject(error);
        },
      );
    });
  }
  private queued() {
    let queued = 0;
    for (const entry of this.entries.values()) if (!entry.started) queued++;
    return queued;
  }
  // In-flight consumers keep their work, but an event prevents caching its eventual answer.
  invalidate(match: (key: string) => boolean = () => true) {
    for (const [key, entry] of this.entries) {
      if (!match(key)) continue;
      if (entry.settled) this.entries.delete(key);
      else entry.invalidated = true;
    }
  }
  // Records a result obtained some other way, e.g. one response that answered many keys.
  prime(key: string, value: T, ttl: number, speculative = true) {
    const current = this.entries.get(key);
    if (current && !current.settled) return;
    this.entries.set(key, {
      controller: new AbortController(),
      consumers: new Set(),
      promise: Promise.resolve(value),
      start: () => {},
      started: true,
      settled: true,
      expires: Date.now() + ttl,
      speculative,
      value,
    });
  }
  has(key: string) {
    const entry = this.entries.get(key);
    return !!entry && (!entry.settled || entry.expires > Date.now());
  }
  clear() {
    for (const entry of this.entries.values()) entry.controller.abort();
    this.entries.clear();
  }
  private drain() {
    // Bound retained query IDs without evicting requests that still have consumers.
    for (const [key, entry] of this.entries) {
      if (entry.settled && (entry.expires <= Date.now() || this.entries.size > 128))
        this.entries.delete(key);
      if (!entry.started && entry.consumers.size && this.running < this.concurrency) entry.start();
    }
  }
}
