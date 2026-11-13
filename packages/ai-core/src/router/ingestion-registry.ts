import type { IngestionAdapter, RawIngestInput } from "../adapters/base-adapter";
import { KortexAiError } from "../errors";

export interface RegisterOptions {
  /** Higher runs first. Ties keep registration order. Default 0. */
  priority?: number;
}

interface Entry {
  adapter: IngestionAdapter;
  priority: number;
  order: number;
}

/**
 * Holds all ingestion adapters. `resolve()` returns the highest-priority adapter
 * whose `canHandle` matches; `candidates()` returns every match in order so the
 * pipeline can fall through when an adapter declines.
 */
export class IngestionRegistry {
  private entries: Entry[] = [];
  private counter = 0;

  register(adapter: IngestionAdapter, { priority = 0 }: RegisterOptions = {}): this {
    if (this.entries.some((e) => e.adapter.id === adapter.id)) {
      throw new KortexAiError(`Adapter "${adapter.id}" is already registered`);
    }
    this.entries.push({ adapter, priority, order: this.counter++ });
    this.entries.sort((a, b) => b.priority - a.priority || a.order - b.order);
    return this;
  }

  unregister(id: string): boolean {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.adapter.id !== id);
    return this.entries.length !== before;
  }

  get(id: string): IngestionAdapter | undefined {
    return this.entries.find((e) => e.adapter.id === id)?.adapter;
  }

  /** All adapters, highest priority first. */
  list(): IngestionAdapter[] {
    return this.entries.map((e) => e.adapter);
  }

  candidates(input: RawIngestInput): IngestionAdapter[] {
    return this.entries.filter((e) => safeCanHandle(e.adapter, input)).map((e) => e.adapter);
  }

  resolve(input: RawIngestInput): IngestionAdapter | undefined {
    return this.entries.find((e) => safeCanHandle(e.adapter, input))?.adapter;
  }
}

// A buggy canHandle must not take the whole registry down.
function safeCanHandle(adapter: IngestionAdapter, input: RawIngestInput): boolean {
  try {
    return adapter.canHandle(input);
  } catch {
    return false;
  }
}
