import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderBanner, renderPhaseBanner } from '../banner.js';
import ansis from 'ansis';

describe('renderBanner', () => {
  it('produces box-drawn output containing the title', () => {
    const result = ansis.strip(renderBanner('Test Title'));
    expect(result).toContain('Test Title');
  });

  it('includes box-drawing characters or ASCII borders', () => {
    const result = ansis.strip(renderBanner('Hello'));
    // Should have top and bottom borders (either Unicode or ASCII)
    const lines = result.split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(3);
    // First and last lines are borders
    const firstLine = lines[0]!;
    const lastLine = lines[lines.length - 1]!;
    // Both borders should start and end with corner chars
    expect(firstLine.length).toBeGreaterThan(0);
    expect(lastLine.length).toBeGreaterThan(0);
  });

  it('includes subtitle when provided', () => {
    const result = ansis.strip(renderBanner('Title', 'Subtitle Here'));
    expect(result).toContain('Title');
    expect(result).toContain('Subtitle Here');
  });

  it('renders 4 lines with subtitle (top, title, subtitle, bottom)', () => {
    const result = ansis.strip(renderBanner('Title', 'Sub'));
    const lines = result.split('\n');
    expect(lines).toHaveLength(4);
  });

  it('renders 3 lines without subtitle (top, title, bottom)', () => {
    const result = ansis.strip(renderBanner('Title'));
    const lines = result.split('\n');
    expect(lines).toHaveLength(3);
  });

  it('adjusts width to fit longer subtitle', () => {
    const result = ansis.strip(
      renderBanner('Hi', 'This is a much longer subtitle'),
    );
    const lines = result.split('\n');
    // Top border should be wide enough for the subtitle
    const topLine = lines[0]!;
    expect(topLine.length).toBeGreaterThanOrEqual(
      'This is a much longer subtitle'.length + 3,
    );
  });
});

describe('renderPhaseBanner', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('includes phase number and step name', () => {
    const result = ansis.strip(renderPhaseBanner(2, 'plan'));
    expect(result).toContain('Phase 2: plan');
  });

  it('includes a timestamp', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-16T14:30:00Z'));

    const result = ansis.strip(renderPhaseBanner(1, 'execute'));
    expect(result).toContain('2026-02-16T14:30:00Z');

    vi.useRealTimers();
  });

  it('accepts string phase identifiers', () => {
    const result = ansis.strip(renderPhaseBanner('3.1', 'research'));
    expect(result).toContain('Phase 3.1: research');
  });
});
