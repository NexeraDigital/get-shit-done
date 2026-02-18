import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StreamRenderer } from '../stream-renderer.js';
import ansis from 'ansis';

/**
 * Mock writable stream that captures written strings in an array.
 */
function createMockOutput() {
  const chunks: string[] = [];
  return {
    chunks,
    write(data: string): boolean {
      chunks.push(data);
      return true;
    },
    /** Get all written output as a single string, ANSI stripped. */
    text(): string {
      return ansis.strip(chunks.join(''));
    },
  };
}

describe('StreamRenderer', () => {
  let output: ReturnType<typeof createMockOutput>;
  let renderer: StreamRenderer;

  beforeEach(() => {
    output = createMockOutput();
    renderer = new StreamRenderer('default', output);
  });

  describe('stream_event rendering', () => {
    it('writes text when receiving a text_delta', () => {
      renderer.render({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'Hello world' },
        },
      });
      expect(output.text()).toContain('Hello world');
    });

    it('writes tool name on content_block_start for tool_use', () => {
      renderer.render({
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          content_block: { type: 'tool_use', name: 'Read' },
        },
      });
      expect(output.text()).toContain('[Read]');
    });

    it('stops spinner on text content', () => {
      renderer.render({
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          content_block: { type: 'text' },
        },
      });
      // No error means spinner stop was safe (idempotent when null)
      expect(output.chunks.length).toBe(0); // text block start doesn't write
    });
  });

  describe('verbosity filtering', () => {
    it('quiet mode suppresses non-error content', () => {
      const quietOutput = createMockOutput();
      const quietRenderer = new StreamRenderer('quiet', quietOutput);

      quietRenderer.render({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'This should be hidden' },
        },
      });

      expect(quietOutput.text()).toBe('');
    });

    it('quiet mode still shows error results', () => {
      const quietOutput = createMockOutput();
      const quietRenderer = new StreamRenderer('quiet', quietOutput);

      quietRenderer.render({
        type: 'result',
        subtype: 'error',
        is_error: true,
        result: 'Something failed',
        usage: {
          input_tokens: 100,
          output_tokens: 50,
        },
      });

      expect(quietOutput.text()).toContain('Error');
      expect(quietOutput.text()).toContain('Something failed');
    });

    it('verbose mode shows system init messages', () => {
      const verboseOutput = createMockOutput();
      const verboseRenderer = new StreamRenderer('verbose', verboseOutput);

      verboseRenderer.render({
        type: 'system',
        subtype: 'init',
        session_id: 'sess_123abc',
      });

      expect(verboseOutput.text()).toContain('Session: sess_123abc');
    });

    it('default mode hides system init messages', () => {
      renderer.render({
        type: 'system',
        subtype: 'init',
        session_id: 'sess_123abc',
      });

      expect(output.text()).toBe('');
    });
  });

  describe('showBanner', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('writes phase/step banner to output', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-16T14:30:00Z'));

      renderer.showBanner(2, 'plan');

      expect(output.text()).toContain('Phase 2: plan');
      expect(output.text()).toContain('2026-02-16');

      vi.useRealTimers();
    });
  });

  describe('result messages', () => {
    it('shows token usage summary', () => {
      renderer.render({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'Done',
        duration_ms: 5500,
        num_turns: 3,
        usage: {
          input_tokens: 1200,
          output_tokens: 800,
          cache_read_input_tokens: 500,
        },
      });

      const text = output.text();
      expect(text).toContain('1200 in');
      expect(text).toContain('800 out');
      expect(text).toContain('500 cached');
      expect(text).toContain('3 turns');
      expect(text).toContain('5.5s');
    });

    it('shows error result with error styling', () => {
      renderer.render({
        type: 'result',
        subtype: 'error',
        is_error: true,
        result: 'Command failed',
        usage: {
          input_tokens: 100,
          output_tokens: 50,
        },
      });

      expect(output.text()).toContain('[Error]');
      expect(output.text()).toContain('Command failed');
    });
  });

  describe('assistant messages', () => {
    it('renders text content blocks', () => {
      renderer.render({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Here is my analysis.' },
          ],
        },
      });

      expect(output.text()).toContain('Here is my analysis.');
    });

    it('renders tool_use content blocks with tool name', () => {
      renderer.render({
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', name: 'Bash' },
          ],
        },
      });

      expect(output.text()).toContain('[Bash]');
    });
  });

  describe('sub-agent prefixes', () => {
    it('shows agent prefix when parent_tool_use_id is tracked', () => {
      // First, simulate a Task tool_use starting to register the agent
      renderer.render({
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          content_block: { type: 'tool_use', name: 'Task', id: 'tu_123' },
        },
      });

      // Simulate input JSON delta with agent type
      renderer.render({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: {
            type: 'input_json_delta',
            partial_json: '{"subagent_type": "researcher", "description": "Research stuff"}',
          },
        },
      });

      // Agent registration now happens on content_block_stop
      renderer.render({
        type: 'stream_event',
        event: { type: 'content_block_stop' },
      });

      // Now simulate a text delta from the sub-agent
      output.chunks.length = 0; // clear previous output
      renderer.render({
        type: 'stream_event',
        parent_tool_use_id: 'tu_123',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'Research findings' },
        },
      });

      expect(output.text()).toContain('[researcher]');
      expect(output.text()).toContain('Research findings');
    });

    it('uses default prefix for unknown parent_tool_use_id', () => {
      renderer.render({
        type: 'stream_event',
        parent_tool_use_id: 'tu_unknown',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'Some output' },
        },
      });

      expect(output.text()).toContain('[default]');
      expect(output.text()).toContain('Some output');
    });
  });

  describe('tool progress', () => {
    it('writes tool progress content', () => {
      renderer.render({
        type: 'tool_progress',
        content: 'Reading file...',
        tool_name: 'Read',
      });

      expect(output.text()).toContain('Reading file...');
    });
  });

  describe('tool use summary', () => {
    it('writes tool name and parameters', () => {
      renderer.render({
        type: 'tool_use_summary',
        tool_name: 'Write',
        parameters: { file_path: '/src/index.ts' },
      });

      expect(output.text()).toContain('[Write]');
      expect(output.text()).toContain('/src/index.ts');
    });
  });

  describe('tool summary extraction', () => {
    /** Helper: simulate full tool_use lifecycle and return stripped output. */
    function renderToolUse(
      renderer: StreamRenderer,
      output: ReturnType<typeof createMockOutput>,
      toolName: string,
      inputJson: Record<string, unknown>,
    ): string {
      renderer.render({
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          content_block: { type: 'tool_use', name: toolName, id: 'tu_test' },
        },
      });
      renderer.render({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: {
            type: 'input_json_delta',
            partial_json: JSON.stringify(inputJson),
          },
        },
      });
      renderer.render({
        type: 'stream_event',
        event: { type: 'content_block_stop' },
      });
      return output.text();
    }

    it('shows Bash command summary', () => {
      const text = renderToolUse(renderer, output, 'Bash', { command: 'git status' });
      expect(text).toContain('[Bash]');
      expect(text).toContain('git status');
    });

    it.each([
      ['Read', { file_path: 'src/components/App.tsx' }, 'src/components/App.tsx'],
      ['Write', { file_path: '/tmp/out.json', content: '{}' }, '/tmp/out.json'],
      ['Edit', { file_path: 'lib/utils.ts', old_string: 'a', new_string: 'b' }, 'lib/utils.ts'],
      ['Glob', { pattern: '**/*.test.ts' }, '**/*.test.ts'],
      ['Grep', { pattern: 'TODO' }, 'TODO'],
      ['WebFetch', { url: 'https://example.com' }, 'https://example.com'],
      ['WebSearch', { query: 'vitest mocking' }, 'vitest mocking'],
      ['Skill', { skill: 'commit' }, 'commit'],
    ])('shows %s summary: %s', (toolName, params, expected) => {
      const text = renderToolUse(renderer, output, toolName, params);
      expect(text).toContain(`[${toolName}]`);
      expect(text).toContain(expected);
    });

    it('shows Task summary with description and agent type', () => {
      const text = renderToolUse(renderer, output, 'Task', {
        description: 'Explore codebase patterns',
        subagent_type: 'Explore',
        prompt: 'Find all route handlers',
      });
      expect(text).toContain('[Task]');
      expect(text).toContain('Explore codebase patterns (Explore)');
    });

    it('truncates long Bash commands at 80 chars', () => {
      const longCmd = 'a'.repeat(100);
      const text = renderToolUse(renderer, output, 'Bash', { command: longCmd });
      expect(text).toContain('a'.repeat(80) + '...');
      expect(text).not.toContain('a'.repeat(81));
    });

    it('handles malformed JSON without crashing', () => {
      renderer.render({
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          content_block: { type: 'tool_use', name: 'Bash', id: 'tu_bad' },
        },
      });
      // Send incomplete JSON
      renderer.render({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'input_json_delta', partial_json: '{"command": "git st' },
        },
      });
      // Should not throw
      renderer.render({
        type: 'stream_event',
        event: { type: 'content_block_stop' },
      });
      // Just has the tool name, no summary (graceful degradation)
      expect(output.text()).toContain('[Bash]');
    });

    it('shows empty summary for unknown tools', () => {
      const text = renderToolUse(renderer, output, 'CustomTool', { foo: 'bar' });
      expect(text).toContain('[CustomTool]');
      // No parameter summary for unknown tools — just the name
      expect(text).not.toContain('bar');
    });
  });

  describe('text deduplication', () => {
    it('does not duplicate text when stream_event and assistant both arrive', () => {
      // Stream path renders text
      renderer.render({
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          content_block: { type: 'text' },
        },
      });
      renderer.render({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'Hello world' },
        },
      });

      // Assistant message arrives with same content (includePartialMessages)
      renderer.render({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Hello world' }],
        },
      });

      const text = output.text();
      const firstIdx = text.indexOf('Hello world');
      const secondIdx = text.indexOf('Hello world', firstIdx + 1);
      expect(firstIdx).toBeGreaterThanOrEqual(0);
      expect(secondIdx).toBe(-1); // Should NOT appear a second time
    });

    it('renders assistant message when no prior stream_events exist', () => {
      // No stream events — assistant message should render (fallback path)
      renderer.render({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Fallback rendering' }],
        },
      });

      expect(output.text()).toContain('Fallback rendering');
    });

    it('deduplicates per parent_tool_use_id', () => {
      // Stream text under sub-agent
      renderer.render({
        type: 'stream_event',
        parent_tool_use_id: 'tu_sub',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'Sub output' },
        },
      });

      // Assistant message for same parent — should be skipped
      renderer.render({
        type: 'assistant',
        parent_tool_use_id: 'tu_sub',
        message: {
          content: [{ type: 'text', text: 'Sub output' }],
        },
      });

      const text = output.text();
      const firstIdx = text.indexOf('Sub output');
      const secondIdx = text.indexOf('Sub output', firstIdx + 1);
      expect(firstIdx).toBeGreaterThanOrEqual(0);
      expect(secondIdx).toBe(-1);
    });
  });

  describe('user messages', () => {
    it('does not render user messages', () => {
      renderer.render({
        type: 'user',
        message: { content: 'user input' },
      });

      expect(output.text()).toBe('');
    });
  });
});
