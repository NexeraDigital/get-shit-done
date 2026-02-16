import { describe, it, expect } from 'vitest';
import {
  shouldDisplay,
  categorizeMessage,
  type VerbosityLevel,
  type MessageCategory,
} from '../verbosity.js';

describe('shouldDisplay', () => {
  describe('quiet mode', () => {
    const verbosity: VerbosityLevel = 'quiet';

    it('shows errors', () => {
      expect(shouldDisplay(verbosity, 'error')).toBe(true);
    });

    it('hides content', () => {
      expect(shouldDisplay(verbosity, 'content')).toBe(false);
    });

    it('hides tool messages', () => {
      expect(shouldDisplay(verbosity, 'tool')).toBe(false);
    });

    it('hides system messages', () => {
      expect(shouldDisplay(verbosity, 'system')).toBe(false);
    });

    it('hides result messages', () => {
      expect(shouldDisplay(verbosity, 'result')).toBe(false);
    });

    it('hides status messages', () => {
      expect(shouldDisplay(verbosity, 'status')).toBe(false);
    });
  });

  describe('default mode', () => {
    const verbosity: VerbosityLevel = 'default';

    it('shows errors', () => {
      expect(shouldDisplay(verbosity, 'error')).toBe(true);
    });

    it('shows content', () => {
      expect(shouldDisplay(verbosity, 'content')).toBe(true);
    });

    it('shows tool messages', () => {
      expect(shouldDisplay(verbosity, 'tool')).toBe(true);
    });

    it('hides system messages', () => {
      expect(shouldDisplay(verbosity, 'system')).toBe(false);
    });

    it('shows result messages', () => {
      expect(shouldDisplay(verbosity, 'result')).toBe(true);
    });

    it('shows status messages', () => {
      expect(shouldDisplay(verbosity, 'status')).toBe(true);
    });
  });

  describe('verbose mode', () => {
    const verbosity: VerbosityLevel = 'verbose';
    const allCategories: MessageCategory[] = [
      'content',
      'tool',
      'system',
      'error',
      'result',
      'status',
    ];

    it('shows all message categories', () => {
      for (const category of allCategories) {
        expect(shouldDisplay(verbosity, category)).toBe(true);
      }
    });
  });
});

describe('categorizeMessage', () => {
  it('categorizes stream_event as content', () => {
    expect(categorizeMessage('stream_event')).toBe('content');
  });

  it('categorizes assistant as content', () => {
    expect(categorizeMessage('assistant')).toBe('content');
  });

  it('categorizes tool_progress as tool', () => {
    expect(categorizeMessage('tool_progress')).toBe('tool');
  });

  it('categorizes tool_use_summary as tool', () => {
    expect(categorizeMessage('tool_use_summary')).toBe('tool');
  });

  it('categorizes result as result', () => {
    expect(categorizeMessage('result')).toBe('result');
  });

  it('categorizes auth_status as system', () => {
    expect(categorizeMessage('auth_status')).toBe('system');
  });

  it('categorizes system with init subtype as system', () => {
    expect(categorizeMessage('system', 'init')).toBe('system');
  });

  it('categorizes system with status subtype as status', () => {
    expect(categorizeMessage('system', 'status')).toBe('status');
  });

  it('categorizes system with task_notification subtype as tool', () => {
    expect(categorizeMessage('system', 'task_notification')).toBe('tool');
  });

  it('categorizes system with unknown subtype as system', () => {
    expect(categorizeMessage('system', 'compact_boundary')).toBe('system');
  });

  it('categorizes unknown message type as content', () => {
    expect(categorizeMessage('some_unknown_type')).toBe('content');
  });
});
