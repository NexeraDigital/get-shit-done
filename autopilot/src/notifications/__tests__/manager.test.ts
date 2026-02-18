import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NotificationManager } from '../manager.js';
import type { Notification, NotificationAdapter } from '../types.js';

function makeNotification(overrides?: Partial<Notification>): Notification {
  return {
    id: 'test-id-123',
    type: 'question',
    title: 'Phase 3: Authentication?',
    body: 'What approach for authentication?',
    severity: 'info',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeMockAdapter(name: string, options?: {
  initFails?: boolean;
  sendFails?: boolean;
}): NotificationAdapter & { sends: Notification[] } {
  const adapter = {
    name,
    sends: [] as Notification[],
    init: vi.fn(async () => {
      if (options?.initFails) throw new Error(`${name} init failed`);
    }),
    send: vi.fn(async (notification: Notification) => {
      if (options?.sendFails) throw new Error(`${name} send failed`);
      adapter.sends.push(notification);
    }),
    close: vi.fn(async () => {}),
  };
  return adapter;
}

describe('NotificationManager', () => {
  describe('notify()', () => {
    it('calls send() on all adapters', async () => {
      const manager = new NotificationManager();
      const adapter1 = makeMockAdapter('adapter1');
      const adapter2 = makeMockAdapter('adapter2');
      manager.addAdapter(adapter1);
      manager.addAdapter(adapter2);

      const notification = makeNotification();
      await manager.notify(notification);

      expect(adapter1.send).toHaveBeenCalledOnce();
      expect(adapter1.send).toHaveBeenCalledWith(notification);
      expect(adapter2.send).toHaveBeenCalledOnce();
      expect(adapter2.send).toHaveBeenCalledWith(notification);
    });

    it('uses Promise.allSettled so one failure does not block others', async () => {
      const manager = new NotificationManager();
      const failingAdapter = makeMockAdapter('failing', { sendFails: true });
      const successAdapter = makeMockAdapter('success');
      manager.addAdapter(failingAdapter);
      manager.addAdapter(successAdapter);

      const notification = makeNotification();
      // Should not throw even though first adapter fails
      await expect(manager.notify(notification)).resolves.toBeUndefined();

      expect(failingAdapter.send).toHaveBeenCalledOnce();
      expect(successAdapter.send).toHaveBeenCalledOnce();
      expect(successAdapter.sends).toHaveLength(1);
    });

    it('console fallback attempted when all adapters fail', async () => {
      const manager = new NotificationManager();
      const failingAdapter = makeMockAdapter('failing', { sendFails: true });
      const consoleAdapter = makeMockAdapter('console', { sendFails: false });
      // console adapter added -- it's always included and will receive even though other failed
      manager.addAdapter(consoleAdapter);
      manager.addAdapter(failingAdapter);

      const notification = makeNotification();
      await manager.notify(notification);

      // Console adapter was called even though failingAdapter failed
      expect(consoleAdapter.send).toHaveBeenCalledOnce();
      expect(consoleAdapter.sends).toHaveLength(1);
    });

    it('logs error but does not throw when all adapters fail', async () => {
      const manager = new NotificationManager();
      const failingAdapter = makeMockAdapter('failing', { sendFails: true });
      manager.addAdapter(failingAdapter);

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const notification = makeNotification();

      await expect(manager.notify(notification)).resolves.toBeUndefined();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('init()', () => {
    it('removes adapters that fail to initialize', async () => {
      const manager = new NotificationManager();
      const failingAdapter = makeMockAdapter('failing', { initFails: true });
      const goodAdapter = makeMockAdapter('good');
      manager.addAdapter(failingAdapter);
      manager.addAdapter(goodAdapter);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await manager.init();

      // After init, notify should only call the good adapter
      const notification = makeNotification();
      await manager.notify(notification);

      expect(failingAdapter.send).not.toHaveBeenCalled();
      expect(goodAdapter.send).toHaveBeenCalledOnce();

      warnSpy.mockRestore();
    });

    it('warns about adapters removed during init', async () => {
      const manager = new NotificationManager();
      const failingAdapter = makeMockAdapter('failing', { initFails: true });
      manager.addAdapter(failingAdapter);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await manager.init();

      expect(warnSpy).toHaveBeenCalledOnce();
      warnSpy.mockRestore();
    });
  });

  describe('startReminder()', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('re-notifies after reminderMs timeout', async () => {
      const manager = new NotificationManager({ questionReminderMs: 1000 });
      const adapter = makeMockAdapter('test');
      manager.addAdapter(adapter);

      const notification = makeNotification();
      await manager.notify(notification);
      expect(adapter.send).toHaveBeenCalledOnce();

      manager.startReminder('q-1', notification);

      // Advance past the reminder timeout
      await vi.advanceTimersByTimeAsync(1100);

      expect(adapter.send).toHaveBeenCalledTimes(2);
    });

    it('does not fire before reminderMs', async () => {
      const manager = new NotificationManager({ questionReminderMs: 5000 });
      const adapter = makeMockAdapter('test');
      manager.addAdapter(adapter);

      const notification = makeNotification();
      manager.startReminder('q-1', notification);

      await vi.advanceTimersByTimeAsync(4999);

      expect(adapter.send).not.toHaveBeenCalled();
    });
  });

  describe('cancelReminder()', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('prevents re-notification after cancellation', async () => {
      const manager = new NotificationManager({ questionReminderMs: 1000 });
      const adapter = makeMockAdapter('test');
      manager.addAdapter(adapter);

      const notification = makeNotification();
      manager.startReminder('q-1', notification);
      manager.cancelReminder('q-1');

      await vi.advanceTimersByTimeAsync(2000);

      expect(adapter.send).not.toHaveBeenCalled();
    });

    it('is a no-op for unknown question IDs', () => {
      const manager = new NotificationManager();
      // Should not throw
      expect(() => manager.cancelReminder('nonexistent')).not.toThrow();
    });
  });

  describe('close()', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('clears reminders and calls adapter.close()', async () => {
      const manager = new NotificationManager({ questionReminderMs: 1000 });
      const adapter = makeMockAdapter('test');
      manager.addAdapter(adapter);

      const notification = makeNotification();
      manager.startReminder('q-1', notification);

      await manager.close();

      // Advance past reminder time -- should NOT fire because close() cancelled it
      await vi.advanceTimersByTimeAsync(2000);

      expect(adapter.send).not.toHaveBeenCalled();
      expect(adapter.close).toHaveBeenCalledOnce();
    });

    it('calls close() on all adapters', async () => {
      const manager = new NotificationManager();
      const adapter1 = makeMockAdapter('adapter1');
      const adapter2 = makeMockAdapter('adapter2');
      manager.addAdapter(adapter1);
      manager.addAdapter(adapter2);

      await manager.close();

      expect(adapter1.close).toHaveBeenCalledOnce();
      expect(adapter2.close).toHaveBeenCalledOnce();
    });
  });

  describe('createNotification()', () => {
    it('generates an ID and createdAt timestamp', () => {
      const notification = NotificationManager.createNotification({
        type: 'complete',
        title: 'Done',
        body: 'All phases complete',
        severity: 'info',
      });

      expect(notification.id).toBeDefined();
      expect(notification.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(notification.createdAt).toBeDefined();
      expect(notification.type).toBe('complete');
      expect(notification.title).toBe('Done');
    });
  });
});
