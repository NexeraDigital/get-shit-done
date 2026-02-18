import { describe, it, expect, vi } from 'vitest';
import { ConsoleAdapter } from '../adapters/console.js';
import type { Notification } from '../types.js';

/** Array-backed string collector implementing WritableOutput for tests. */
class StringOutput {
  readonly chunks: string[] = [];

  write(data: string): boolean {
    this.chunks.push(data);
    return true;
  }

  get output(): string {
    return this.chunks.join('');
  }
}

function makeAdapter(port = 3847, output?: StringOutput) {
  const out = output ?? new StringOutput();
  const adapter = new ConsoleAdapter({ port, output: out });
  return { adapter, out };
}

function makeNotification(overrides?: Partial<Notification>): Notification {
  return {
    id: 'abc-123',
    type: 'question',
    title: 'Phase 3: What approach for authentication?',
    body: 'Choose the authentication strategy for the project',
    severity: 'info',
    options: ['JWT tokens', 'Session cookies'],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('ConsoleAdapter', () => {
  describe('question notification', () => {
    it('includes full question title', async () => {
      const { adapter, out } = makeAdapter();
      await adapter.send(makeNotification());
      expect(out.output).toContain('Phase 3: What approach for authentication?');
    });

    it('includes all option labels', async () => {
      const { adapter, out } = makeAdapter();
      await adapter.send(makeNotification());
      expect(out.output).toContain('JWT tokens');
      expect(out.output).toContain('Session cookies');
    });

    it('includes clickable URL with correct port and question ID', async () => {
      const { adapter, out } = makeAdapter(3847);
      await adapter.send(makeNotification({ id: 'abc-123' }));
      expect(out.output).toContain('http://localhost:3847/questions/abc-123');
    });

    it('uses custom port in URL', async () => {
      const { adapter, out } = makeAdapter(9000);
      await adapter.send(makeNotification({ id: 'xyz-999' }));
      expect(out.output).toContain('http://localhost:9000/questions/xyz-999');
    });

    it('includes terminal bell character (\\x07)', async () => {
      const { adapter, out } = makeAdapter();
      await adapter.send(makeNotification());
      expect(out.output).toContain('\x07');
    });

    it('uses [?] prefix', async () => {
      const { adapter, out } = makeAdapter();
      await adapter.send(makeNotification());
      expect(out.output).toContain('[?]');
    });
  });

  describe('error notification', () => {
    it('does NOT include terminal bell', async () => {
      const { adapter, out } = makeAdapter();
      await adapter.send(makeNotification({
        type: 'error',
        title: 'Autopilot stopped: Command failed',
        body: 'Phase 3 execute step failed',
        options: undefined,
      }));
      expect(out.output).not.toContain('\x07');
    });

    it('includes [!] prefix', async () => {
      const { adapter, out } = makeAdapter();
      await adapter.send(makeNotification({
        type: 'error',
        title: 'Autopilot stopped: Command failed after retry',
        body: 'Phase 3, execute',
      }));
      expect(out.output).toContain('[!]');
    });

    it('includes summary when provided', async () => {
      const { adapter, out } = makeAdapter();
      await adapter.send(makeNotification({
        type: 'error',
        title: 'Autopilot stopped',
        body: 'Error occurred',
        summary: '2 of 7 phases completed in 12 min',
      }));
      expect(out.output).toContain('2 of 7 phases completed in 12 min');
    });

    it('includes next steps when provided', async () => {
      const { adapter, out } = makeAdapter();
      await adapter.send(makeNotification({
        type: 'error',
        title: 'Autopilot stopped',
        body: 'Error occurred',
        nextSteps: 'Run `gsd-autopilot --resume` to retry from phase 3',
      }));
      expect(out.output).toContain('gsd-autopilot --resume');
    });
  });

  describe('complete notification', () => {
    it('does NOT include terminal bell', async () => {
      const { adapter, out } = makeAdapter();
      await adapter.send(makeNotification({
        type: 'complete',
        title: 'Build complete: 7 of 7 phases completed',
        body: 'All phases finished successfully',
        options: undefined,
      }));
      expect(out.output).not.toContain('\x07');
    });

    it('uses [v] prefix', async () => {
      const { adapter, out } = makeAdapter();
      await adapter.send(makeNotification({
        type: 'complete',
        title: 'Build complete: 7 of 7 phases completed in 2.3 hours',
        body: 'All phases done',
      }));
      expect(out.output).toContain('[v]');
    });

    it('includes summary and next steps', async () => {
      const { adapter, out } = makeAdapter();
      await adapter.send(makeNotification({
        type: 'complete',
        title: 'Build complete',
        body: 'Done',
        summary: '7 of 7 phases completed in 2.3 hours',
        nextSteps: 'Review output in .planning/ directory',
      }));
      expect(out.output).toContain('7 of 7 phases completed in 2.3 hours');
      expect(out.output).toContain('Review output in .planning/ directory');
    });
  });

  describe('progress notification', () => {
    it('uses [i] prefix', async () => {
      const { adapter, out } = makeAdapter();
      await adapter.send(makeNotification({
        type: 'progress',
        title: 'Phase 3 discuss complete',
        body: '',
        options: undefined,
      }));
      expect(out.output).toContain('[i]');
    });

    it('does NOT include terminal bell', async () => {
      const { adapter, out } = makeAdapter();
      await adapter.send(makeNotification({
        type: 'progress',
        title: 'Phase 3 discuss complete',
        body: '',
        options: undefined,
      }));
      expect(out.output).not.toContain('\x07');
    });
  });

  describe('stopSpinner callback', () => {
    it('is called before writing output', async () => {
      const stopSpinner = vi.fn();
      const out = new StringOutput();
      const adapter = new ConsoleAdapter({ port: 3847, stopSpinner, output: out });

      await adapter.send(makeNotification());

      expect(stopSpinner).toHaveBeenCalledOnce();
      // Spinner should be stopped BEFORE output is written
      expect(out.chunks).toHaveLength(1);
    });

    it('works without stopSpinner (optional)', async () => {
      const { adapter, out } = makeAdapter();
      // Should not throw even without stopSpinner
      await expect(adapter.send(makeNotification())).resolves.toBeUndefined();
      expect(out.chunks).toHaveLength(1);
    });
  });

  describe('lifecycle', () => {
    it('init() resolves without error', async () => {
      const { adapter } = makeAdapter();
      await expect(adapter.init()).resolves.toBeUndefined();
    });

    it('close() resolves without error', async () => {
      const { adapter } = makeAdapter();
      await expect(adapter.close()).resolves.toBeUndefined();
    });

    it('has name "console"', () => {
      const { adapter } = makeAdapter();
      expect(adapter.name).toBe('console');
    });
  });
});
