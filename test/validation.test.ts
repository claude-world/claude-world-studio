/**
 * validation.test.ts
 *
 * Tests for Zod validation schemas (server/validation.ts).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CreateSessionSchema,
  UpdateSessionSchema,
  CreateAccountSchema,
  PublishSchema,
  CreateTaskSchema,
  parseBody,
} from "../server/validation.js";

describe("CreateSessionSchema", () => {
  it("valid with title", () => {
    const result = CreateSessionSchema.safeParse({ title: "My Session" });
    assert.ok(result.success);
    assert.strictEqual(result.data.title, "My Session");
  });

  it("valid without title (optional)", () => {
    const result = CreateSessionSchema.safeParse({});
    assert.ok(result.success);
    assert.strictEqual(result.data.title, undefined);
  });

  it("valid with workspacePath", () => {
    const result = CreateSessionSchema.safeParse({ workspacePath: "/tmp/test" });
    assert.ok(result.success);
    assert.strictEqual(result.data.workspacePath, "/tmp/test");
  });

  it("rejects title longer than 200 characters", () => {
    const result = CreateSessionSchema.safeParse({ title: "x".repeat(201) });
    assert.strictEqual(result.success, false);
  });

  it("accepts title at exactly 200 characters", () => {
    const result = CreateSessionSchema.safeParse({ title: "x".repeat(200) });
    assert.ok(result.success);
  });
});

describe("UpdateSessionSchema", () => {
  it("valid with title", () => {
    const result = UpdateSessionSchema.safeParse({ title: "Updated Title" });
    assert.ok(result.success);
    assert.strictEqual(result.data.title, "Updated Title");
  });

  it("rejects empty string title (min 1)", () => {
    const result = UpdateSessionSchema.safeParse({ title: "" });
    assert.strictEqual(result.success, false);
  });

  it("rejects title longer than 200 characters", () => {
    const result = UpdateSessionSchema.safeParse({ title: "y".repeat(201) });
    assert.strictEqual(result.success, false);
  });

  it("valid with no fields (all optional)", () => {
    const result = UpdateSessionSchema.safeParse({});
    assert.ok(result.success);
  });
});

describe("CreateAccountSchema", () => {
  const validAccount = {
    name: "Test Account",
    handle: "@testaccount",
    platform: "threads" as const,
  };

  it("valid full object", () => {
    const result = CreateAccountSchema.safeParse({
      ...validAccount,
      token: "abc123",
      user_id: "user_1",
      style: "casual",
      persona_prompt: "Be friendly",
      auto_publish: true,
    });
    assert.ok(result.success);
  });

  it("valid minimal object", () => {
    const result = CreateAccountSchema.safeParse(validAccount);
    assert.ok(result.success);
    assert.strictEqual(result.data.name, "Test Account");
  });

  it("rejects missing name", () => {
    const { name, ...rest } = validAccount;
    const result = CreateAccountSchema.safeParse(rest);
    assert.strictEqual(result.success, false);
  });

  it("rejects missing handle", () => {
    const { handle, ...rest } = validAccount;
    const result = CreateAccountSchema.safeParse(rest);
    assert.strictEqual(result.success, false);
  });

  it("rejects missing platform", () => {
    const { platform, ...rest } = validAccount;
    const result = CreateAccountSchema.safeParse(rest);
    assert.strictEqual(result.success, false);
  });

  it("rejects invalid platform value", () => {
    const result = CreateAccountSchema.safeParse({
      ...validAccount,
      platform: "twitter",
    });
    assert.strictEqual(result.success, false);
  });

  it('accepts "threads" platform', () => {
    const result = CreateAccountSchema.safeParse({
      ...validAccount,
      platform: "threads",
    });
    assert.ok(result.success);
  });

  it('accepts "instagram" platform', () => {
    const result = CreateAccountSchema.safeParse({
      ...validAccount,
      platform: "instagram",
    });
    assert.ok(result.success);
  });

  it("rejects name longer than 100 characters", () => {
    const result = CreateAccountSchema.safeParse({
      ...validAccount,
      name: "a".repeat(101),
    });
    assert.strictEqual(result.success, false);
  });

  it("rejects empty name", () => {
    const result = CreateAccountSchema.safeParse({
      ...validAccount,
      name: "",
    });
    assert.strictEqual(result.success, false);
  });

  it("auto_publish accepts boolean and number", () => {
    const boolResult = CreateAccountSchema.safeParse({
      ...validAccount,
      auto_publish: true,
    });
    assert.ok(boolResult.success);

    const numResult = CreateAccountSchema.safeParse({
      ...validAccount,
      auto_publish: 1,
    });
    assert.ok(numResult.success);
  });
});

describe("PublishSchema", () => {
  const validPublish = {
    accountId: "acc-123",
    text: "Hello world",
  };

  it("valid minimal (accountId + text)", () => {
    const result = PublishSchema.safeParse(validPublish);
    assert.ok(result.success);
    assert.strictEqual(result.data.accountId, "acc-123");
    assert.strictEqual(result.data.text, "Hello world");
  });

  it("rejects text longer than 500 characters", () => {
    const result = PublishSchema.safeParse({
      ...validPublish,
      text: "x".repeat(501),
    });
    assert.strictEqual(result.success, false);
  });

  it("rejects empty text", () => {
    const result = PublishSchema.safeParse({
      ...validPublish,
      text: "",
    });
    assert.strictEqual(result.success, false);
  });

  it("rejects missing accountId", () => {
    const result = PublishSchema.safeParse({ text: "hello" });
    assert.strictEqual(result.success, false);
  });

  it("rejects empty accountId", () => {
    const result = PublishSchema.safeParse({ accountId: "", text: "hello" });
    assert.strictEqual(result.success, false);
  });

  it("validates optional imageUrl is URL format", () => {
    const validResult = PublishSchema.safeParse({
      ...validPublish,
      imageUrl: "https://example.com/img.png",
    });
    assert.ok(validResult.success);

    const invalidResult = PublishSchema.safeParse({
      ...validPublish,
      imageUrl: "not-a-url",
    });
    assert.strictEqual(invalidResult.success, false);
  });

  it("imageUrl accepts empty string", () => {
    const result = PublishSchema.safeParse({
      ...validPublish,
      imageUrl: "",
    });
    assert.ok(result.success);
  });

  it("validates carouselUrls requires 2-20 URL items", () => {
    // Valid: 2 URLs
    const valid = PublishSchema.safeParse({
      ...validPublish,
      carouselUrls: ["https://a.com/1.png", "https://a.com/2.png"],
    });
    assert.ok(valid.success);

    // Invalid: 1 URL (min 2)
    const tooFew = PublishSchema.safeParse({
      ...validPublish,
      carouselUrls: ["https://a.com/1.png"],
    });
    assert.strictEqual(tooFew.success, false);

    // Invalid: 21 URLs (max 20)
    const tooMany = PublishSchema.safeParse({
      ...validPublish,
      carouselUrls: Array.from({ length: 21 }, (_, i) => `https://a.com/${i}.png`),
    });
    assert.strictEqual(tooMany.success, false);
  });

  it("validates pollOptions as string with max 500 chars", () => {
    const valid = PublishSchema.safeParse({
      ...validPublish,
      pollOptions: "Option A|Option B|Option C",
    });
    assert.ok(valid.success);

    const tooLong = PublishSchema.safeParse({
      ...validPublish,
      pollOptions: "x".repeat(501),
    });
    assert.strictEqual(tooLong.success, false);
  });

  it("validates optional score is 0-100", () => {
    const valid = PublishSchema.safeParse({ ...validPublish, score: 85 });
    assert.ok(valid.success);

    const tooLow = PublishSchema.safeParse({ ...validPublish, score: -1 });
    assert.strictEqual(tooLow.success, false);

    const tooHigh = PublishSchema.safeParse({ ...validPublish, score: 101 });
    assert.strictEqual(tooHigh.success, false);
  });

  it("validates replyControl enum values", () => {
    const valid = PublishSchema.safeParse({
      ...validPublish,
      replyControl: "everyone",
    });
    assert.ok(valid.success);

    const invalid = PublishSchema.safeParse({
      ...validPublish,
      replyControl: "nobody",
    });
    assert.strictEqual(invalid.success, false);
  });

  it("accepts full object with many optional fields", () => {
    const result = PublishSchema.safeParse({
      ...validPublish,
      sessionId: "sess-1",
      score: 90,
      imageUrl: "https://example.com/img.png",
      linkComment: "https://example.com",
      sourceUrl: "https://source.com/article",
      ghost: true,
      topicTag: "tech",
      altText: "A photo",
      replyControl: "mentioned_only",
    });
    assert.ok(result.success);
  });
});

describe("CreateTaskSchema", () => {
  const validTask = {
    name: "Daily Post",
    account_id: "acc-1",
    prompt_template: "Write a post about {{topic}}",
    schedule: "0 9 * * *",
  };

  it("valid full object", () => {
    const result = CreateTaskSchema.safeParse({
      ...validTask,
      timezone: "America/New_York",
      enabled: true,
      min_score: 70,
      max_retries: 3,
      timeout_ms: 120000,
      auto_publish: 1,
    });
    assert.ok(result.success);
  });

  it("valid minimal object", () => {
    const result = CreateTaskSchema.safeParse(validTask);
    assert.ok(result.success);
  });

  it("rejects missing name", () => {
    const { name, ...rest } = validTask;
    const result = CreateTaskSchema.safeParse(rest);
    assert.strictEqual(result.success, false);
  });

  it("rejects missing account_id", () => {
    const { account_id, ...rest } = validTask;
    const result = CreateTaskSchema.safeParse(rest);
    assert.strictEqual(result.success, false);
  });

  it("rejects missing prompt_template", () => {
    const { prompt_template, ...rest } = validTask;
    const result = CreateTaskSchema.safeParse(rest);
    assert.strictEqual(result.success, false);
  });

  it("rejects missing schedule", () => {
    const { schedule, ...rest } = validTask;
    const result = CreateTaskSchema.safeParse(rest);
    assert.strictEqual(result.success, false);
  });

  it("rejects prompt_template longer than 10000 characters", () => {
    const result = CreateTaskSchema.safeParse({
      ...validTask,
      prompt_template: "x".repeat(10001),
    });
    assert.strictEqual(result.success, false);
  });

  it("accepts prompt_template at exactly 10000 characters", () => {
    const result = CreateTaskSchema.safeParse({
      ...validTask,
      prompt_template: "x".repeat(10000),
    });
    assert.ok(result.success);
  });

  it("rejects name longer than 200 characters", () => {
    const result = CreateTaskSchema.safeParse({
      ...validTask,
      name: "n".repeat(201),
    });
    assert.strictEqual(result.success, false);
  });

  it("rejects schedule shorter than 5 characters", () => {
    const result = CreateTaskSchema.safeParse({
      ...validTask,
      schedule: "abc",
    });
    assert.strictEqual(result.success, false);
  });

  it("validates timeout_ms range (10000-600000)", () => {
    const tooLow = CreateTaskSchema.safeParse({
      ...validTask,
      timeout_ms: 5000,
    });
    assert.strictEqual(tooLow.success, false);

    const tooHigh = CreateTaskSchema.safeParse({
      ...validTask,
      timeout_ms: 700000,
    });
    assert.strictEqual(tooHigh.success, false);

    const valid = CreateTaskSchema.safeParse({
      ...validTask,
      timeout_ms: 60000,
    });
    assert.ok(valid.success);
  });

  it("validates max_retries range (0-10)", () => {
    const tooHigh = CreateTaskSchema.safeParse({
      ...validTask,
      max_retries: 11,
    });
    assert.strictEqual(tooHigh.success, false);

    const valid = CreateTaskSchema.safeParse({
      ...validTask,
      max_retries: 5,
    });
    assert.ok(valid.success);
  });
});

describe("parseBody helper", () => {
  it("returns success with valid data", () => {
    const result = parseBody(CreateSessionSchema, { title: "Test" });
    assert.ok(result.success);
    if (result.success) {
      assert.strictEqual(result.data.title, "Test");
    }
  });

  it("returns error string with invalid data", () => {
    const result = parseBody(UpdateSessionSchema, { title: "" });
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.ok(typeof result.error === "string");
      assert.ok(result.error.startsWith("Validation failed:"));
    }
  });

  it("error message includes field path", () => {
    const result = parseBody(CreateAccountSchema, {
      name: "",
      handle: "test",
      platform: "threads",
    });
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.ok(result.error.includes("name"), `error should mention 'name', got: ${result.error}`);
    }
  });

  it("error message includes multiple field paths for multiple errors", () => {
    const result = parseBody(CreateAccountSchema, {});
    assert.strictEqual(result.success, false);
    if (!result.success) {
      // Should mention at least name, handle, and platform
      assert.ok(result.error.includes("name"), "should mention name");
      assert.ok(result.error.includes("handle"), "should mention handle");
      assert.ok(result.error.includes("platform"), "should mention platform");
    }
  });

  it("returns success:true with data property for valid input", () => {
    const result = parseBody(PublishSchema, {
      accountId: "acc-1",
      text: "hello",
    });
    assert.ok(result.success);
    assert.ok("data" in result);
    assert.strictEqual(result.data.accountId, "acc-1");
  });
});
