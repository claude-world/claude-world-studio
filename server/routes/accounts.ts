import { Router } from "express";
import store from "../db.js";
import {
  CreateAccountSchema,
  UpdateAccountSchema,
  ToggleAutoPublishSchema,
  parseBody,
} from "../validation.js";

function maskToken(token: string): string {
  if (!token || token.length < 12) return token ? "***" : "";
  return token.slice(0, 8) + "..." + token.slice(-4);
}

const router = Router();

// List all accounts (tokens masked)
router.get("/", (_req, res) => {
  const accounts = store.getAllAccounts().map((a) => ({
    ...a,
    token: maskToken(a.token),
  }));
  res.json(accounts);
});

// Get single account (token masked)
router.get("/:id", (req, res) => {
  const account = store.getAccount(req.params.id);
  if (!account) {
    return res.status(404).json({ error: "Account not found" });
  }
  res.json({ ...account, token: maskToken(account.token) });
});

// Get post history for an account
router.get("/:id/posts", (req, res) => {
  const account = store.getAccount(req.params.id);
  if (!account) {
    return res.status(404).json({ error: "Account not found" });
  }
  const limit = Math.max(1, Math.min(parseInt(req.query.limit as string) || 100, 500));
  const posts = store.getPublishByAccount(req.params.id, limit);
  res.json(posts);
});

// Create account
router.post("/", (req, res) => {
  const parsed = parseBody(CreateAccountSchema, req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error });

  const { name, handle, platform, token, user_id, style, persona_prompt, auto_publish } =
    parsed.data;

  const account = store.createAccount({
    name,
    handle,
    platform,
    token,
    user_id,
    style,
    persona_prompt,
  });
  // auto_publish is handled via update since createAccount doesn't include it
  if (auto_publish !== undefined) {
    store.updateAccount(account.id, {
      name: account.name,
      handle: account.handle,
      platform: account.platform,
      user_id: account.user_id,
      style: account.style,
      persona_prompt: account.persona_prompt,
      auto_publish: auto_publish ? 1 : 0,
    });
  }
  const updated = store.getAccount(account.id)!;
  res.status(201).json({ ...updated, token: maskToken(updated.token) });
});

// Update account
router.put("/:id", (req, res) => {
  const existing = store.getAccount(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: "Account not found" });
  }

  const parsed = parseBody(UpdateAccountSchema, req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error });

  const { name, handle, platform, token, user_id, style, persona_prompt, auto_publish } =
    parsed.data;

  store.updateAccount(req.params.id, {
    name: name ?? existing.name,
    handle: handle ?? existing.handle,
    platform: platform ?? existing.platform,
    user_id: user_id ?? existing.user_id,
    style: style ?? existing.style,
    persona_prompt: persona_prompt ?? existing.persona_prompt,
    auto_publish: auto_publish !== undefined ? (auto_publish ? 1 : 0) : existing.auto_publish,
  });

  // Only update token if a non-empty value is provided
  if (token) {
    store.updateAccountToken(req.params.id, token);
  }

  const updated = store.getAccount(req.params.id)!;
  res.json({ ...updated, token: maskToken(updated.token) });
});

// Toggle auto_publish for an account
router.patch("/:id/auto-publish", (req, res) => {
  const existing = store.getAccount(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: "Account not found" });
  }

  const parsed = parseBody(ToggleAutoPublishSchema, req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error });
  const { auto_publish } = parsed.data;

  store.updateAccount(req.params.id, {
    name: existing.name,
    handle: existing.handle,
    platform: existing.platform,
    user_id: existing.user_id,
    style: existing.style,
    persona_prompt: existing.persona_prompt,
    auto_publish: auto_publish ? 1 : 0,
  });

  const updated = store.getAccount(req.params.id)!;
  res.json({ ...updated, token: maskToken(updated.token) });
});

// Delete account
router.delete("/:id", (req, res) => {
  const deleted = store.deleteAccount(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: "Account not found" });
  }
  res.json({ success: true });
});

export default router;
