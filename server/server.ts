import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import path from "path";
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3001;

const app = express();
app.use(cors({ origin: /^https?:\/\/localhost(:\d+)?$/ }));
app.use(express.json());

// Serve static files from client directory
app.use("/client", express.static(path.join(__dirname, "../client")));

// Serve index.html at root
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../client/index.html"));
});

// REST API routes
app.use("/api/sessions", sessionsRouter);
app.use("/api/sessions", filesRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/publish", publishRouter);
app.use("/api/accounts", accountsRouter);

// Session management (long-lived agent sessions)
const sessions: Map<string, Session> = new Map();

/**
 * Get or create an in-memory Session for a validated sessionId.
 * Returns null if the session doesn't exist in DB.
 */
function getSession(sessionId: string): Session | null {
  let session = sessions.get(sessionId);
  if (session) return session;

  const dbSession = store.getSession(sessionId);
  if (!dbSession) return null;

  const settings = getSettings();
  session = new Session(sessionId, dbSession.workspace_path, settings.language);
  sessions.set(sessionId, session);
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
  }
}

// Expose removeSession so the sessions router can call it on DELETE
export { removeSession };

// Create HTTP server
const server = createServer(app);

// WebSocket server
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws: WSClient) => {
  ws.isAlive = true;

  ws.send(
    JSON.stringify({ type: "connected", message: "Connected to Claude World Studio" })
  );

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("message", (data) => {
    try {
      const message: IncomingWSMessage = JSON.parse(data.toString());

      switch (message.type) {
        case "subscribe": {
          const session = getSession(message.sessionId);
          if (!session) {
            ws.send(JSON.stringify({
              type: "error",
              error: "Session not found",
              sessionId: message.sessionId,
            }));
            break;
          }
          session.subscribe(ws);

          // Send existing messages from DB
          const messages = store.getMessages(message.sessionId);
          ws.send(
            JSON.stringify({
              type: "history",
              messages,
              sessionId: message.sessionId,
            })
          );
          break;
        }

        case "chat": {
          if (!message.content?.trim()) {
            ws.send(JSON.stringify({ type: "error", error: "Empty message" }));
            break;
          }
          const session = getSession(message.sessionId);
          if (!session) {
            ws.send(JSON.stringify({
              type: "error",
              error: "Session not found",
              sessionId: message.sessionId,
            }));
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
              if (wsClient.sessionId === message.sessionId && wsClient.readyState === wsClient.OPEN) {
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
      console.error("Error handling WebSocket message:", error);
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

wss.on("close", () => {
  clearInterval(heartbeat);
});

// Start server
server.listen(PORT, () => {
  console.log(`Claude World Studio running at http://localhost:${PORT}`);
  console.log(`WebSocket endpoint at ws://localhost:${PORT}/ws`);
  console.log(`Frontend dev server at http://localhost:5173`);
});
