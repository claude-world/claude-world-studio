import { Router } from "express";
import store from "../db.js";
import { removeSession } from "../server.js";
import { CreateSessionSchema, UpdateSessionSchema, parseBody } from "../validation.js";
import { validateWorkspacePath } from "../runtime-paths.js";

const router = Router();

// List all sessions
router.get("/", (_req, res) => {
  const sessions = store.getAllSessions();
  res.json(sessions);
});

// Create new session
router.post("/", (req, res) => {
  const parsed = parseBody(CreateSessionSchema, req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error });

  const { title, workspacePath } = parsed.data;
  let safeWorkspacePath = workspacePath;

  // Validate workspacePath if provided (filesystem checks that Zod can't do)
  if (workspacePath) {
    const validation = validateWorkspacePath(workspacePath);
    if (!validation.ok) return res.status(400).json({ error: validation.error });
    safeWorkspacePath = validation.realPath;
  }

  const session = store.createSession(title, safeWorkspacePath);
  res.status(201).json(session);
});

// Get single session
router.get("/:id", (req, res) => {
  const session = store.getSession(req.params.id);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }
  res.json(session);
});

// Update session title
router.patch("/:id", (req, res) => {
  const parsed = parseBody(UpdateSessionSchema, req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error });

  const { title } = parsed.data;
  if (!title) {
    return res.status(400).json({ error: "Title required" });
  }
  const session = store.getSession(req.params.id);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }
  store.updateSessionTitle(req.params.id, title);
  res.json({ success: true });
});

// Delete session (also clean up in-memory agent session)
router.delete("/:id", (req, res) => {
  removeSession(req.params.id);
  const deleted = store.deleteSession(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: "Session not found" });
  }
  res.json({ success: true });
});

// Get session messages
router.get("/:id/messages", (req, res) => {
  const messages = store.getMessages(req.params.id);
  res.json(messages);
});

export default router;
