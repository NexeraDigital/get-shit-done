// Config type definitions with Zod schema per CONTEXT.md locked decisions
// Config format: JSON only (.gsd-autopilot.json)
// Environment variable prefix: GSD_AUTOPILOT_

import { z } from 'zod';

export const AutopilotConfigSchema = z.object({
  // Notification
  notify: z.enum(['console', 'system', 'teams', 'slack', 'webhook']).default('console'),
  webhookUrl: z.string().url().optional(),
  adapterPath: z.string().optional(),
  questionReminderMs: z.number().int().min(0).default(300_000), // 5 min default

  // Server
  port: z.number().int().min(1024).max(65535).default(3847),

  // Execution
  depth: z.enum(['quick', 'standard', 'comprehensive']).default('standard'),
  model: z.enum(['quality', 'balanced', 'budget']).default('balanced'),
  skipDiscuss: z.boolean().default(false),
  skipVerify: z.boolean().default(false),

  // Verbosity
  verbose: z.boolean().default(false),
  quiet: z.boolean().default(false),
});

export type AutopilotConfig = z.infer<typeof AutopilotConfigSchema>;
