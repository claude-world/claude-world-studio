import { z } from "zod";

// Sessions
export const CreateSessionSchema = z.object({
  title: z.string().max(200).optional(),
  workspacePath: z.string().optional(),
});

export const UpdateSessionSchema = z.object({
  title: z.string().min(1).max(200).optional(),
});

// Accounts
export const CreateAccountSchema = z.object({
  name: z.string().min(1).max(100),
  handle: z.string().min(1).max(100),
  platform: z.literal("threads"),
  token: z.string().optional(),
  user_id: z.string().optional(),
  style: z.string().max(500).optional(),
  persona_prompt: z.string().max(2000).optional(),
  auto_publish: z.union([z.boolean(), z.number()]).optional(),
});

export const UpdateAccountSchema = CreateAccountSchema.partial();

// Publishing
export const PublishSchema = z.object({
  accountId: z.string().min(1),
  text: z.string().min(1).max(500),
  sessionId: z.string().optional(),
  score: z.number().min(0).max(100).optional(),
  // Media
  imageUrl: z.string().url().optional().or(z.literal("")),
  videoUrl: z.string().url().optional().or(z.literal("")),
  carouselUrls: z.array(z.string().url()).min(2).max(20).optional(),
  // Poll — pipe-separated string matching PublishOptions type (e.g. "A|B|C")
  pollOptions: z.string().max(500).optional(),
  gifId: z.string().max(100).optional(),
  // Links
  linkComment: z.string().url().optional().or(z.literal("")),
  linkAttachment: z.string().url().optional().or(z.literal("")),
  textAttachment: z.string().max(500).optional(),
  sourceUrl: z.string().url().optional().or(z.literal("")),
  // Spoiler — types matching PublishOptions: spoilerMedia=boolean, spoilerText=string[]
  spoilerMedia: z.boolean().optional(),
  spoilerText: z.array(z.string().max(100)).max(10).optional(),
  // Special
  ghost: z.boolean().optional(),
  quotePostId: z.string().max(100).optional(),
  // Controls
  replyControl: z.enum(["everyone", "accounts_you_follow", "mentioned_only"]).optional(),
  topicTag: z.string().max(100).optional(),
  altText: z.string().max(500).optional(),
});

// Scheduled Tasks
export const CreateTaskSchema = z.object({
  name: z.string().min(1).max(200),
  account_id: z.string().min(1),
  prompt_template: z.string().min(1).max(10000),
  schedule: z.string().min(5).max(100),
  timezone: z.string().max(50).optional(),
  enabled: z.union([z.boolean(), z.number().int().min(0).max(1)]).optional(),
  min_score: z.number().min(0).max(100).optional(),
  max_retries: z.number().min(0).max(10).optional(),
  timeout_ms: z.number().min(10000).max(600000).optional(),
  auto_publish: z.union([z.boolean(), z.number()]).optional(),
});

export const UpdateTaskSchema = CreateTaskSchema.partial();

// Batch publish / refresh-insights
export const BatchPublishSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(50),
});

export const BatchRefreshInsightsSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(20),
});

// Toggle auto-publish for an account
export const ToggleAutoPublishSchema = z.object({
  auto_publish: z.union([z.boolean(), z.number().int().min(0).max(1)]),
});

// Messages
export const SendMessageSchema = z.object({
  content: z.string().min(1).max(50000),
});

// Helper to parse and return validation error
export function parseBody<T>(
  schema: z.ZodType<T>,
  body: unknown
): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(body);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const messages = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  return { success: false, error: `Validation failed: ${messages}` };
}
