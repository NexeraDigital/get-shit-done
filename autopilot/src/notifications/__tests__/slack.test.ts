import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SlackAdapter } from '../adapters/slack.js';
import type { Notification } from '../types.js';

const WEBHOOK_URL = 'https://hooks.slack.com/services/T000/B000/xxxx';

const makeNotification = (overrides: Partial<Notification> = {}): Notification => ({
  id: 'test-id-002',
  type: 'question',
  title: 'Phase 3: Architecture Decision',
  body: 'Which database should we use?',
  severity: 'info',
  createdAt: '2026-02-18T00:00:00.000Z',
  ...overrides,
});

describe('SlackAdapter', () => {
  let adapter: SlackAdapter;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    adapter = new SlackAdapter({ webhookUrl: WEBHOOK_URL });
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => 'ok',
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('send() POSTs Block Kit to webhook URL', async () => {
    const notification = makeNotification();

    await adapter.send(notification);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(WEBHOOK_URL);
    expect(options.method).toBe('POST');
    expect((options.headers as Record<string, string>)['Content-Type']).toBe('application/json');

    const parsedBody = JSON.parse(options.body as string) as Record<string, unknown>;
    expect(parsedBody.blocks).toBeDefined();
    expect(Array.isArray(parsedBody.blocks)).toBe(true);
  });

  it('send() includes fallback text field required by Slack API', async () => {
    const notification = makeNotification();

    await adapter.send(notification);

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const parsedBody = JSON.parse(options.body as string) as Record<string, unknown>;

    // top-level `text` is required by Slack API for notifications and unfurling
    expect(parsedBody.text).toBeDefined();
    expect(typeof parsedBody.text).toBe('string');
    expect(parsedBody.text as string).toContain(notification.title);
    expect(parsedBody.text as string).toContain(notification.body);
  });

  it('send() includes dashboard link when respondUrl present', async () => {
    const notification = makeNotification({
      respondUrl: 'http://localhost:3847/questions/test-id-002',
    });

    await adapter.send(notification);

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const parsedBody = JSON.parse(options.body as string) as Record<string, unknown>;
    const blocks = parsedBody.blocks as Array<Record<string, unknown>>;

    // Should have 3 blocks: header, section (body), section (dashboard link)
    expect(blocks).toHaveLength(3);
    const linkBlock = blocks[2]!;
    expect(linkBlock.type).toBe('section');
    const blockText = linkBlock.text as Record<string, string>;
    expect(blockText.type).toBe('mrkdwn');
    expect(blockText.text).toContain('http://localhost:3847/questions/test-id-002');
    expect(blockText.text).toContain('Open Dashboard');
    // Slack mrkdwn link format: <url|label>
    expect(blockText.text).toMatch(/<http.*\|Open Dashboard>/);
  });

  it('send() omits dashboard link when no respondUrl', async () => {
    const notification = makeNotification({ type: 'progress' });
    // no respondUrl

    await adapter.send(notification);

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const parsedBody = JSON.parse(options.body as string) as Record<string, unknown>;
    const blocks = parsedBody.blocks as Array<Record<string, unknown>>;

    // Should have only 2 blocks: header and body
    expect(blocks).toHaveLength(2);
    const bodyText = JSON.stringify(blocks);
    expect(bodyText).not.toContain('Open Dashboard');
  });

  it('send() throws on non-ok response', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'invalid_payload',
    });

    const notification = makeNotification();
    await expect(adapter.send(notification)).rejects.toThrow('Slack webhook returned 400');
  });

  it('init() is a no-op', async () => {
    await expect(adapter.init()).resolves.toBeUndefined();
  });

  it('close() is a no-op', async () => {
    await expect(adapter.close()).resolves.toBeUndefined();
  });

  it('name is "slack"', () => {
    expect(adapter.name).toBe('slack');
  });
});
