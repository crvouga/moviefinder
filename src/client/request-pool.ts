type Entry<T> = {
  controller: AbortController;
  consumers: Set<object>;
  promise: Promise<T>;
  start: () => void;
  started: boolean;
  settled: boolean;
  expires: number;
};

// Retains only request metadata/results such as query IDs. Entities remain in TanStack DB.
export class RequestPool<T> {
  private entries = new Map<string, Entry<T>>();
  private running = 0;
  constructor(
    private concurrency = 3,
    private onEvent: (
      event: string,
      fields: Record<string, string | number | boolean>,
    ) => void = () => {},
  ) {}

  run(
    key: string,
    load: (signal: AbortSignal) => Promise<T>,
    options: { signal?: AbortSignal; speculative?: boolean; ttl?: () => number } = {},
  ): Promise<T> {
    const { signal, speculative = false, ttl = () => 30_000 } = options;
    if (signal?.aborted) return Promise.reject(signal.reason);
    let entry = this.entries.get(key);
    if (entry?.settled && entry.expires <= Date.now()) {
      this.entries.delete(key);
      entry = undefined;
    }
    if (!entry) {
      const controller = new AbortController();
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
        start: () => {
          if (entry!.started) return;
          entry!.started = true;
          this.running++;
          this.onEvent("start", { key, running: this.running, queued: this.queued() });
          void load(controller.signal)
            .then(
              (value) => {
                entry!.settled = true;
                entry!.expires = Date.now() + ttl();
                resolve(value);
              },
              (error: unknown) => {
                if (this.entries.get(key) === entry) this.entries.delete(key);
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
    });
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
  invalidate() {
    for (const [key, entry] of this.entries) if (entry.settled) this.entries.delete(key);
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
