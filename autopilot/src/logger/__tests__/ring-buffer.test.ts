import { describe, it, expect } from 'vitest';
import { RingBuffer } from '../ring-buffer.js';

describe('RingBuffer', () => {
  it('starts empty with size 0 and toArray returns []', () => {
    const buf = new RingBuffer<number>(5);
    expect(buf.size).toBe(0);
    expect(buf.toArray()).toEqual([]);
  });

  it('push one item: size is 1, toArray returns [item]', () => {
    const buf = new RingBuffer<string>(5);
    buf.push('hello');
    expect(buf.size).toBe(1);
    expect(buf.toArray()).toEqual(['hello']);
  });

  it('push to capacity: size equals capacity, toArray returns all in order', () => {
    const buf = new RingBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    expect(buf.size).toBe(3);
    expect(buf.toArray()).toEqual([1, 2, 3]);
  });

  it('push beyond capacity: size stays at capacity, oldest item is gone', () => {
    const buf = new RingBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    buf.push(4); // overwrites 1
    expect(buf.size).toBe(3);
    expect(buf.toArray()).not.toContain(1);
    expect(buf.toArray()).toContain(4);
  });

  it('toArray returns items in insertion order after overflow', () => {
    const buf = new RingBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    buf.push(4); // overwrites 1
    buf.push(5); // overwrites 2
    expect(buf.toArray()).toEqual([3, 4, 5]);
  });

  it('clear resets size to 0 and toArray returns []', () => {
    const buf = new RingBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    buf.clear();
    expect(buf.size).toBe(0);
    expect(buf.toArray()).toEqual([]);
  });

  it('works with string type', () => {
    const buf = new RingBuffer<string>(2);
    buf.push('alpha');
    buf.push('beta');
    buf.push('gamma'); // overwrites alpha
    expect(buf.toArray()).toEqual(['beta', 'gamma']);
  });

  it('works with object type', () => {
    interface Item { id: number; name: string }
    const buf = new RingBuffer<Item>(2);
    buf.push({ id: 1, name: 'one' });
    buf.push({ id: 2, name: 'two' });
    buf.push({ id: 3, name: 'three' }); // overwrites id:1
    expect(buf.toArray()).toEqual([
      { id: 2, name: 'two' },
      { id: 3, name: 'three' },
    ]);
  });

  it('capacity of 1: always contains only the last pushed item', () => {
    const buf = new RingBuffer<number>(1);
    buf.push(10);
    expect(buf.size).toBe(1);
    expect(buf.toArray()).toEqual([10]);

    buf.push(20);
    expect(buf.size).toBe(1);
    expect(buf.toArray()).toEqual([20]);

    buf.push(30);
    expect(buf.size).toBe(1);
    expect(buf.toArray()).toEqual([30]);
  });

  it('handles many overflows correctly', () => {
    const buf = new RingBuffer<number>(3);
    for (let i = 0; i < 100; i++) {
      buf.push(i);
    }
    expect(buf.size).toBe(3);
    expect(buf.toArray()).toEqual([97, 98, 99]);
  });
});
