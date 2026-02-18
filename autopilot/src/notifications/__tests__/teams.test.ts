import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TeamsAdapter } from '../adapters/teams.js';
import type { Notification } from '../types.js';

const WEBHOOK_URL = 'https://example.webhook.office.com/webhookb2/test';

const makeNotification = (overrides: Partial<Notification> = {}): Notification => ({
  id: 'test-id-001',
  type: 'question',
  title: 'Phase 3: Architecture Decision',
  body: 'Which database should we use?',
  severity: 'info',
  createdAt: '2026-02-18T00:00:00.000Z',
  ...overrides,
});

describe('TeamsAdapter', () => {
  let adapter: TeamsAdapter;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    adapter = new TeamsAdapter({ webhookUrl: WEBHOOK_URL });
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => 'OK',
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('send() POSTs Adaptive Card to webhook URL', async () => {
    const notification = makeNotification();

    await adapter.send(notification);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(WEBHOOK_URL);
    expect(options.method).toBe('POST');
    expect((options.headers as Record<string, string>)['Content-Type']).toBe('application/json');

    const parsedBody = JSON.parse(options.body as string) as Record<string, unknown>;
    expect(parsedBody.type).toBe('message');

    const attachments = parsedBody.attachments as Array<Record<string, unknown>>;
    expect(attachments).toHaveLength(1);
    expect(attachments[0]!.contentType).toBe('application/vnd.microsoft.card.adaptive');

    const content = attachments[0]!.content as Record<string, unknown>;
    expect(content.type).toBe('AdaptiveCard');
  });

  it('send() includes dashboard link when respondUrl present', async () => {
    const notification = makeNotification({
      respondUrl: 'http://localhost:3847/questions/test-id-001',
    });

    await adapter.send(notification);

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const parsedBody = JSON.parse(options.body as string) as Record<string, unknown>;
    const attachments = parsedBody.attachments as Array<Record<string, unknown>>;
    const content = attachments[0]!.content as Record<string, unknown>;
    const body = content.body as Array<Record<string, unknown>>;

    // Should have 3 blocks: title, body, dashboard link
    expect(body).toHaveLength(3);
    const linkBlock = body[2]!;
    expect(linkBlock.type).toBe('TextBlock');
    expect(linkBlock.text).toContain('http://localhost:3847/questions/test-id-001');
    expect(linkBlock.text).toContain('Open Dashboard');
  });

  it('send() omits dashboard link when no respondUrl', async () => {
    const notification = makeNotification({ type: 'progress' });
    // no respondUrl

    await adapter.send(notification);

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const parsedBody = JSON.parse(options.body as string) as Record<string, unknown>;
    const attachments = parsedBody.attachments as Array<Record<string, unknown>>;
    const content = attachments[0]!.content as Record<string, unknown>;
    const body = content.body as Array<Record<string, unknown>>;

    // Should have only 2 blocks: title and body
    expect(body).toHaveLength(2);
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain('Open Dashboard');
  });

  it('send() throws on non-ok response', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'Bad Request',
    });

    const notification = makeNotification();
    await expect(adapter.send(notification)).rejects.toThrow('Teams webhook returned 400');
  });

  it('init() is a no-op', async () => {
    await expect(adapter.init()).resolves.toBeUndefined();
  });

  it('close() is a no-op', async () => {
    await expect(adapter.close()).resolves.toBeUndefined();
  });

  it('name is "teams"', () => {
    expect(adapter.name).toBe('teams');
  });
});
