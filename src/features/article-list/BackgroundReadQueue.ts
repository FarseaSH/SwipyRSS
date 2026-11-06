export type BackgroundReadFailure = {
  id: number;
  name: string;
  retrying: boolean;
};

/** In-memory jobs retain their original request; retrying never repeats navigation. */
export class BackgroundReadQueue {
  private nextId = 0;
  private readonly jobs = new Map<number, { name: string; run: () => Promise<void>; running: boolean }>();
  private failures: BackgroundReadFailure[] = [];
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  getSnapshot = () => this.failures;

  enqueue(name: string, run: () => Promise<void>) {
    const id = ++this.nextId;
    this.jobs.set(id, { name, run, running: false });
    void this.execute(id);
  }

  retry = (id: number) => { void this.execute(id); };

  private publish() {
    for (const listener of this.listeners) listener();
  }

  private async execute(id: number) {
    const job = this.jobs.get(id);
    if (!job || job.running) return;
    job.running = true;
    this.failures = this.failures.map(item => item.id === id ? { ...item, retrying: true } : item);
    this.publish();
    try {
      await job.run();
      this.jobs.delete(id);
      this.failures = this.failures.filter(item => item.id !== id);
    } catch {
      const failure = { id, name: job.name, retrying: false };
      this.failures = [...this.failures.filter(item => item.id !== id), failure];
    } finally {
      job.running = false;
      this.publish();
    }
  }
}
