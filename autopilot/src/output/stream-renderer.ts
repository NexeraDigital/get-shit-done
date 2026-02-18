/**
 * Terminal formatter that routes SDKMessage objects to type-specific handlers
 * and renders formatted output to a writable stream.
 *
 * WARNING: When maxThinkingTokens or thinking is set, stream_event messages
 * are not emitted. StreamRenderer gracefully degrades to showing complete
 * assistant messages only.
 *
 * All SDK types are duck-typed (checking .type fields) rather than imported
 * from @anthropic-ai/sdk, following the project's SDKResultLike pattern.
 */

import ora from 'ora';
import type { Ora } from 'ora';
import { palette, getAgentPrefix } from './colors.js';
import { shouldDisplay, categorizeMessage } from './verbosity.js';
import type { VerbosityLevel } from './verbosity.js';
import { renderPhaseBanner } from './banner.js';

/** Minimal writable interface for testability. */
interface WritableOutput {
  write(data: string): boolean;
}

export class StreamRenderer {
  private spinner: Ora | null = null;
  private readonly agentMap: Map<string, { name: string }> = new Map();
  private currentToolBlock: { name: string; id: string; input: string } | null = null;
  private streamedParentIds = new Set<string>();
  private readonly verbosity: VerbosityLevel;
  private readonly output: WritableOutput;

  constructor(
    verbosity: VerbosityLevel = 'default',
    output?: WritableOutput,
  ) {
    this.verbosity = verbosity;
    this.output = output ?? process.stdout;
  }

  /**
   * Main dispatch method. Routes an SDK message to the appropriate
   * type-specific renderer after applying verbosity filtering.
   */
  render(message: unknown): void {
    const typed = message as { type?: string; subtype?: string };
    const messageType = typed.type ?? '';
    const subtype = typed.subtype;
    const category = categorizeMessage(messageType, subtype);

    // Errors always pass through regardless of verbosity.
    // Error results (is_error: true) also bypass the verbosity filter.
    const isErrorResult =
      category === 'result' &&
      (typed as { is_error?: boolean }).is_error === true;
    if (
      !shouldDisplay(this.verbosity, category) &&
      category !== 'error' &&
      !isErrorResult
    ) {
      return;
    }

    switch (messageType) {
      case 'stream_event':
        this.renderStreamEvent(message);
        break;
      case 'assistant':
        this.renderAssistantMessage(message);
        break;
      case 'system':
        this.renderSystemMessage(message);
        break;
      case 'tool_progress':
        this.renderToolProgress(message);
        break;
      case 'tool_use_summary':
        this.renderToolUseSummary(message);
        break;
      case 'result':
        this.renderResult(message);
        break;
      case 'user':
        // User messages are not displayed
        break;
      default:
        break;
    }
  }

  /**
   * Handle streaming events (partial messages from includePartialMessages).
   * These contain raw Anthropic API streaming events: content_block_start,
   * content_block_delta, content_block_stop, message_start, message_stop.
   */
  private renderStreamEvent(message: unknown): void {
    const msg = message as {
      event?: {
        type?: string;
        content_block?: { type?: string; name?: string; id?: string };
        delta?: { type?: string; text?: string; partial_json?: string };
        index?: number;
      };
      parent_tool_use_id?: string | null;
    };

    const event = msg.event;
    if (!event) return;

    switch (event.type) {
      case 'content_block_start': {
        const block = event.content_block;
        if (!block) break;

        if (block.type === 'tool_use') {
          this.stopSpinner();
          this.currentToolBlock = { name: block.name ?? '', id: block.id ?? '', input: '' };
          this.streamedParentIds.add(msg.parent_tool_use_id ?? '__root__');
          this.write(palette.toolName(`\n[${block.name}] `));
        } else if (block.type === 'text') {
          this.stopSpinner();
          this.streamedParentIds.add(msg.parent_tool_use_id ?? '__root__');
        }
        break;
      }

      case 'content_block_delta': {
        const delta = event.delta;
        if (!delta) break;

        if (delta.type === 'text_delta' && delta.text) {
          this.stopSpinner();
          this.streamedParentIds.add(msg.parent_tool_use_id ?? '__root__');
          const prefix = this.getPrefix(msg.parent_tool_use_id ?? null);
          this.write(prefix + delta.text);
        } else if (delta.type === 'input_json_delta' && delta.partial_json) {
          if (this.currentToolBlock) {
            this.currentToolBlock.input += delta.partial_json;
          }
        }
        break;
      }

      case 'content_block_stop': {
        if (this.currentToolBlock) {
          const summary = this.extractToolSummary(this.currentToolBlock.name, this.currentToolBlock.input);
          if (summary) {
            this.write(palette.dim(summary));
          }
          // For Task tools, register agent in agentMap for sub-agent prefix coloring
          if (this.currentToolBlock.name === 'Task') {
            this.registerAgent(this.currentToolBlock.id, this.currentToolBlock.input);
          }
          this.currentToolBlock = null;
        }
        break;
      }

      case 'message_start':
        break;

      case 'message_stop':
        // Defensive cleanup in case stream aborted mid-block
        this.currentToolBlock = null;
        break;

      default:
        break;
    }
  }

  /**
   * Handle complete assistant messages (shown when streaming is not available
   * or as final complete messages).
   */
  private renderAssistantMessage(message: unknown): void {
    const msg = message as {
      message?: { content?: Array<{ type?: string; text?: string; name?: string }> };
      parent_tool_use_id?: string | null;
    };

    const parentId = msg.parent_tool_use_id ?? '__root__';
    if (this.streamedParentIds.has(parentId)) {
      this.streamedParentIds.delete(parentId);
      return; // Already rendered via stream_event path
    }

    const content = msg.message?.content;
    if (!Array.isArray(content)) return;

    const prefix = this.getPrefix(msg.parent_tool_use_id ?? null);

    for (const block of content) {
      if (block.type === 'text' && block.text) {
        this.stopSpinner();
        this.write(prefix + block.text);
      } else if (block.type === 'tool_use' && block.name) {
        this.stopSpinner();
        this.write(palette.toolName(`\n[${block.name}] `));
      }
    }
  }

  /**
   * Handle system messages (init, status, task_notification).
   * Only shown in verbose mode (already filtered by shouldDisplay).
   */
  private renderSystemMessage(message: unknown): void {
    const msg = message as {
      subtype?: string;
      session_id?: string;
      summary?: string;
      status?: string;
      message?: string;
    };

    switch (msg.subtype) {
      case 'init':
        this.write(
          palette.system(
            `\n[system] Session: ${msg.session_id ?? 'unknown'}\n`,
          ),
        );
        break;
      case 'task_notification':
        this.write(
          palette.system(
            `\n[task] ${msg.status ?? ''}: ${msg.summary ?? ''}\n`,
          ),
        );
        break;
      case 'status':
        this.write(
          palette.system(`\n[status] ${msg.message ?? ''}\n`),
        );
        break;
      default:
        break;
    }
  }

  /**
   * Handle tool progress messages (live updates from running tools).
   */
  private renderToolProgress(message: unknown): void {
    const msg = message as { content?: string; tool_name?: string };
    const content = msg.content ?? '';

    if (this.spinner?.isSpinning) {
      this.spinner.text = content;
    } else {
      this.write(palette.dim(content));
    }
  }

  /**
   * Handle tool use summary messages (concise one-liner after tool completes).
   */
  private renderToolUseSummary(message: unknown): void {
    const msg = message as {
      tool_name?: string;
      parameters?: Record<string, unknown>;
    };

    const toolName = msg.tool_name ?? 'unknown';
    const params = msg.parameters
      ? JSON.stringify(msg.parameters).slice(0, 100)
      : '';
    this.write(palette.dim(`\n  [${toolName}] ${params}\n`));
  }

  /**
   * Handle result messages (final outcome of a command).
   * Displays token usage summary per user decision.
   */
  private renderResult(message: unknown): void {
    const msg = message as {
      subtype?: string;
      is_error?: boolean;
      result?: string;
      duration_ms?: number;
      num_turns?: number;
      total_cost_usd?: number;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
      };
    };

    this.stopSpinner();

    const isError = msg.is_error === true || msg.subtype === 'error';
    const colorFn = isError ? palette.error : palette.result;

    if (isError) {
      this.write(colorFn(`\n[Error] ${msg.result ?? 'Unknown error'}\n`));
    }

    // Token usage summary
    const usage = msg.usage;
    if (usage) {
      const inputTokens = usage.input_tokens ?? 0;
      const outputTokens = usage.output_tokens ?? 0;
      const cacheRead = usage.cache_read_input_tokens ?? 0;
      const turns = msg.num_turns ?? 0;
      const durationMs = msg.duration_ms ?? 0;

      let summary = `Tokens: ${inputTokens} in / ${outputTokens} out`;
      if (cacheRead > 0) {
        summary += ` (${cacheRead} cached)`;
      }
      summary += ` | ${turns} turns | ${(durationMs / 1000).toFixed(1)}s`;

      this.write(palette.dim(`\n${summary}\n`));
    }
  }

  /**
   * Start an ora spinner with the given text.
   * Use when waiting for SDK response between prompt submission and first content.
   */
  startSpinner(text: string): void {
    if (this.spinner?.isSpinning) {
      this.spinner.text = text;
      return;
    }
    this.spinner = ora({
      text,
      spinner: 'dots',
      stream: this.output as NodeJS.WriteStream,
    }).start();
  }

  /**
   * Stop the spinner if it is currently spinning.
   * MUST be called before writing to stdout to avoid garbled output (Pitfall 1).
   */
  stopSpinner(): void {
    if (this.spinner?.isSpinning) {
      this.spinner.stop();
    }
  }

  /**
   * Show a phase/step transition banner.
   */
  showBanner(phase: number | string, step: string): void {
    this.stopSpinner();
    this.write('\n' + renderPhaseBanner(phase, step) + '\n\n');
  }

  /**
   * Write text to the output stream.
   * Always stops the spinner first to prevent garbled output.
   */
  private write(text: string): void {
    // Spinner stop is idempotent -- safe to call even if not spinning
    this.stopSpinner();
    this.output.write(text);
  }

  /**
   * Get agent prefix for sub-agent messages based on parent_tool_use_id.
   */
  private getPrefix(parentToolUseId: string | null): string {
    if (!parentToolUseId) return '';
    const agent = this.agentMap.get(parentToolUseId);
    if (agent) {
      return getAgentPrefix(agent.name);
    }
    return getAgentPrefix('default');
  }

  /**
   * Extract a concise summary string from a tool's accumulated JSON input.
   * Maps each tool to its most informative parameter for display.
   */
  private extractToolSummary(toolName: string, rawInput: string): string {
    let params: Record<string, unknown>;
    try {
      params = JSON.parse(rawInput);
    } catch {
      return '';
    }

    switch (toolName) {
      case 'Bash': {
        const cmd = typeof params.command === 'string' ? (params.command.split('\n')[0] ?? '') : '';
        return cmd.length > 80 ? cmd.slice(0, 80) + '...' : cmd;
      }
      case 'Read':
      case 'Write':
      case 'Edit':
        return typeof params.file_path === 'string' ? params.file_path : '';
      case 'Glob':
        return typeof params.pattern === 'string' ? params.pattern : '';
      case 'Grep':
        return typeof params.pattern === 'string' ? params.pattern : '';
      case 'Task': {
        const desc = typeof params.description === 'string' ? params.description : '';
        const agent = typeof params.subagent_type === 'string' ? params.subagent_type : '';
        return agent ? `${desc} (${agent})` : desc;
      }
      case 'WebFetch':
        return typeof params.url === 'string' ? params.url : '';
      case 'WebSearch':
        return typeof params.query === 'string' ? params.query : '';
      case 'Skill':
        return typeof params.skill === 'string' ? params.skill : '';
      default:
        return '';
    }
  }

  /**
   * Register a Task tool's sub-agent in the agent map for prefix coloring.
   * Called on content_block_stop when full JSON input is available.
   */
  private registerAgent(toolUseId: string, rawInput: string): void {
    try {
      const params = JSON.parse(rawInput) as Record<string, unknown>;
      const agentType = typeof params.subagent_type === 'string'
        ? params.subagent_type
        : typeof params.agent_type === 'string'
          ? params.agent_type
          : null;
      if (agentType) {
        this.agentMap.set(toolUseId, { name: agentType });
      }
    } catch {
      // Malformed JSON -- skip agent registration
    }
  }
}
