/**
 * Generic fixed-capacity ring buffer (circular buffer).
 *
 * When the buffer is full, pushing a new item overwrites the oldest entry.
 * Items are always returned in insertion order (oldest first) via toArray().
 */
export class RingBuffer<T> {
  private buffer: T[];
  private head: number = 0;
  private count: number = 0;

  constructor(private readonly capacity: number) {
    this.buffer = new Array<T>(capacity);
  }

  /** Add an item. Overwrites the oldest entry when full. */
  push(item: T): void {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  /** Return all items in insertion order (oldest first). */
  toArray(): T[] {
    if (this.count < this.capacity) {
      return this.buffer.slice(0, this.count);
    }
    // When full, head points to the oldest entry
    return [
      ...this.buffer.slice(this.head),
      ...this.buffer.slice(0, this.head),
    ];
  }

  /** Current number of items (0 to capacity). */
  get size(): number {
    return this.count;
  }

  /** Reset the buffer to empty. */
  clear(): void {
    this.buffer = new Array<T>(this.capacity);
    this.head = 0;
    this.count = 0;
  }
}
