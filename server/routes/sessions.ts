import { Router } from "express";
import store from "../db.js";
import { removeSession } from "../server.js";

const router = Router();

// List all sessions
router.get("/", (_req, res) => {
  const sessions = store.getAllSessions();
  res.json(sessions);
});

// Create new session
router.post("/", (req, res) => {
  const { title, workspacePath } = req.body || {};
  const session = store.createSession(title, workspacePath);
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
  const { title } = req.body || {};
  if (!title || typeof title !== "string") {
    return res.status(400).json({ error: "Title required" });
  }
  const session = store.getSession(req.params.id);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }
  store.updateSessionTitle(req.params.id, title.slice(0, 200));
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
