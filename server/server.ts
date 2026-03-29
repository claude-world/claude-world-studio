import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import type { WSClient, IncomingWSMessage } from "./types.js";
import store from "./db.js";
import { Session } from "./session.js";
import { getSettings } from "./mcp-config.js";
import sessionsRouter from "./routes/sessions.js";
import filesRouter from "./routes/files.js";
import settingsRouter from "./routes/settings.js";
import publishRouter from "./routes/publish.js";
import accountsRouter from "./routes/accounts.js";
import scheduledTasksRouter, { setScheduler } from "./routes/scheduled-tasks.js";
import { TaskScheduler } from "./services/scheduler.js";
import { rateLimiter } from "./middleware/rate-limiter.js";
import { logger } from "./logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || "3001", 10);
// Security: bind to localhost only — this server runs bypassPermissions
const HOST = process.env.HOST || "127.0.0.1";

const app = express();
// Only allow our own frontend origins (exact port match)
const ALLOWED_ORIGINS = [
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
  "http://localhost:5173", // Vite dev server
  "http://127.0.0.1:5173",
];
app.use(cors({ origin: ALLOWED_ORIGINS }));
app.use(express.json({ limit: "1mb" }));

// Serve built assets in production, raw client in dev
// Static assets must be served BEFORE the rate limiter so that CSS/JS/images
// don't consume the API rate budget.
const distDir = path.join(__dirname, "../dist");
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get("/", (_req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });
} else {
  app.use("/client", express.static(path.join(__dirname, "../client")));
  app.get("/", (_req, res) => {
    res.sendFile(path.join(__dirname, "../client/index.html"));
  });
}

// Rate limiter applied AFTER static assets so only API routes consume rate budget
app.use(rateLimiter);

// REST API routes
app.use("/api/sessions", sessionsRouter);
app.use("/api/sessions", filesRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/publish", publishRouter);
app.use("/api/accounts", accountsRouter);
app.use("/api/scheduled-tasks", scheduledTasksRouter);

// Terminal error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error("Server", "Unhandled route error", err);
  if (!res.headersSent) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Session management (long-lived agent sessions)
const sessions: Map<string, Session> = new Map();

// Idle session cleanup interval (evict after 30 min without subscribers)
const SESSION_IDLE_MS = 30 * 60 * 1000;
const sessionLastActivity = new Map<string, number>();

function touchSession(sessionId: string) {
  sessionLastActivity.set(sessionId, Date.now());
}

const idleCleanup = setInterval(() => {
  const now = Date.now();
  for (const [id, lastActive] of sessionLastActivity) {
    const session = sessions.get(id);
    if (session && !session.hasSubscribers() && now - lastActive > SESSION_IDLE_MS) {
      session.close();
      sessions.delete(id);
      sessionLastActivity.delete(id);
      logger.info("Server", `Evicted idle session ${id}`);
    }
  }
}, 60_000);

/**
 * Get or create an in-memory Session for a validated sessionId.
 * Returns null if the session doesn't exist in DB.
 */
function getSession(sessionId: string): Session | null {
  let session = sessions.get(sessionId);
  if (session) {
    touchSession(sessionId);
    return session;
  }

  const dbSession = store.getSession(sessionId);
  if (!dbSession) return null;

  const settings = getSettings();
  // Load previous messages so the agent can resume with context
  const previousMessages = store.getMessages(sessionId);
  session = new Session(sessionId, dbSession.workspace_path, settings.language, previousMessages);
  sessions.set(sessionId, session);
  touchSession(sessionId);
  return session;
}

/**
 * Clean up an in-memory session (called on delete or interrupt).
 */
function removeSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (session) {
    session.close();
    sessions.delete(sessionId);
    sessionLastActivity.delete(sessionId);
  }
}

// Expose removeSession so the sessions router can call it on DELETE
export { removeSession };

// Prevent unhandled SDK errors from crashing the server
process.on("uncaughtException", (err) => {
  logger.error("Server", "Uncaught exception (non-fatal)", err);
});
process.on("unhandledRejection", (reason) => {
  logger.error(
    "Server",
    "Unhandled rejection (non-fatal)",
    reason instanceof Error ? reason : new Error(String(reason))
  );
});

// Create HTTP server
const server = createServer(app);

// WebSocket server with origin check (same list as CORS)
const wss = new WebSocketServer({
  server,
  path: "/ws",
  maxPayload: 1 * 1024 * 1024, // 1 MiB
  verifyClient: ({ origin }: { origin?: string }) => {
    // Allow connections without origin (e.g. from CLI tools)
    if (!origin) return true;
    return ALLOWED_ORIGINS.includes(origin);
  },
});

wss.on("connection", (ws: WSClient) => {
  ws.isAlive = true;

  ws.send(JSON.stringify({ type: "connected", message: "Connected to Claude World Studio" }));

  ws.on("error", (err) => {
    logger.error("Server", "WebSocket client error", err);
  });

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("message", (data) => {
    try {
      const message: IncomingWSMessage = JSON.parse(data.toString());

      switch (message.type) {
        case "subscribe": {
          // Unsubscribe from any previous session first
          if (ws.sessionId) {
            const prev = sessions.get(ws.sessionId);
            if (prev) prev.unsubscribe(ws);
          }

          const session = getSession(message.sessionId);
          if (!session) {
            ws.send(
              JSON.stringify({
                type: "error",
                error: "Session not found",
                sessionId: message.sessionId,
              })
            );
            break;
          }
          session.subscribe(ws);

          // Send existing messages from DB + running state
          const messages = store.getMessages(message.sessionId);
          ws.send(
            JSON.stringify({
              type: "history",
              messages,
              sessionId: message.sessionId,
              running: session.isRunning(),
              cliName: session.cliName,
            })
          );
          break;
        }

        case "chat": {
          if (!message.content?.trim()) {
            ws.send(JSON.stringify({ type: "error", error: "Empty message" }));
            break;
          }
          // Unsubscribe from previous session if switching
          if (ws.sessionId && ws.sessionId !== message.sessionId) {
            const prev = sessions.get(ws.sessionId);
            if (prev) prev.unsubscribe(ws);
          }
          const session = getSession(message.sessionId);
          if (!session) {
            ws.send(
              JSON.stringify({
                type: "error",
                error: "Session not found",
                sessionId: message.sessionId,
              })
            );
            break;
          }
          session.subscribe(ws);
          session.sendMessage(message.content);
          break;
        }

        case "interrupt": {
          const session = sessions.get(message.sessionId);
          if (session) {
            removeSession(message.sessionId);
            // Notify all subscribers that session was interrupted
            const interruptMsg = JSON.stringify({
              type: "interrupted",
              sessionId: message.sessionId,
            });
            wss.clients.forEach((client) => {
              const wsClient = client as WSClient;
              if (
                wsClient.sessionId === message.sessionId &&
                wsClient.readyState === wsClient.OPEN
              ) {
                wsClient.send(interruptMsg);
              }
            });
          }
          break;
        }

        default:
          ws.send(JSON.stringify({ type: "error", error: "Unknown message type" }));
      }
    } catch (error) {
      logger.error("Server", "Error handling WebSocket message", error);
      ws.send(JSON.stringify({ type: "error", error: "Invalid message format" }));
    }
  });

  ws.on("close", () => {
    for (const session of sessions.values()) {
      session.unsubscribe(ws);
    }
  });
});

// Heartbeat to detect dead connections
const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    const client = ws as WSClient;
    if (client.isAlive === false) {
      return client.terminate();
    }
    client.isAlive = false;
    client.ping();
  });
}, 30000);

// Also cleared in shutdown() — intentional redundancy for non-graceful wss close
wss.on("close", () => {
  clearInterval(heartbeat);
  clearInterval(idleCleanup);
});

// Initialize task scheduler (started inside listen callback below)
const taskScheduler = new TaskScheduler();
setScheduler(taskScheduler);

// Start server — bound to localhost for security
server.listen(PORT, HOST, () => {
  logger.info("Server", `Claude World Studio running at http://${HOST}:${PORT}`);
  logger.info("Server", `WebSocket endpoint at ws://${HOST}:${PORT}/ws`);
  if (!fs.existsSync(distDir)) {
    logger.info("Server", "Frontend dev server at http://localhost:5173");
  }
  // Start scheduler only after the HTTP server is confirmed listening
  taskScheduler.start();
});

// Handle bind errors (e.g. EADDRINUSE) before the server starts
server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    logger.error("Server", `Port ${PORT} is already in use. Exiting.`, err);
  } else {
    logger.error("Server", "HTTP server error", err);
  }
  process.exit(1);
});

// Graceful shutdown
let isShuttingDown = false;

function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info("Server", "Shutting down...");

  // 1. Stop scheduled tasks
  taskScheduler.stop();

  // 2. Close all active sessions (stops CLI subprocesses & Agent SDK)
  for (const [, session] of sessions) {
    session.close();
  }
  sessions.clear();
  sessionLastActivity.clear();

  // 3. Clear intervals that keep the event loop alive
  clearInterval(idleCleanup);
  clearInterval(heartbeat);

  // 4. Close WebSocket & HTTP servers
  wss.close();
  server.close(() => {
    logger.info("Server", "Clean exit");
    process.exit(0);
  });

  // 5. Force exit if server.close() hangs (open connections, etc.)
  setTimeout(() => {
    logger.error("Server", "Forced exit after timeout");
    process.exit(1);
  }, 5000).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
process.on("SIGHUP", shutdown);
