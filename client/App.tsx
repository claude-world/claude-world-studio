import { useState, useEffect, useCallback, useRef } from "react";
import useWebSocket, { ReadyState } from "react-use-websocket";
import { Sidebar } from "./components/Sidebar";
import { ChatWindow } from "./components/ChatWindow";
import { FileExplorer } from "./components/FileExplorer";
import { FilePreviewModal } from "./components/FilePreviewModal";
import { PublishDialog } from "./components/PublishDialog";
import { SettingsPage } from "./components/SettingsPage";
import { SocialAccountsPage } from "./components/SocialAccountsPage";
import { ScheduledTasksPage } from "./components/ScheduledTasksPage";
import { AccountPostsPage } from "./components/AccountPostsPage";
import { TrafficDashboardPage } from "./components/TrafficDashboardPage";

export type Language = "zh-TW" | "en" | "ja";
export type Theme = "light" | "dark" | "system";

interface Session {
  id: string;
  title: string;
  workspace_path: string;
  created_at: string;
  updated_at: string;
}

interface Message {
  id: string;
  role: "user" | "assistant" | "tool_use" | "tool_result" | "result";
  content: string | null;
  created_at?: string;
  timestamp?: string;
  toolName?: string;
  tool_name?: string;
  toolInput?: Record<string, unknown>;
  tool_input?: string;
  toolId?: string;
  tool_id?: string;
  cost_usd?: number;
}

/** Discriminated union for server→client WebSocket messages */
type ServerWSMessage =
  | { type: "connected" }
  | { type: "history"; messages: Message[]; sessionId: string; running?: boolean; cliName?: string }
  | { type: "user_message"; content: string; sessionId: string }
  | { type: "assistant_message"; content: string; sessionId: string }
  | { type: "tool_use"; toolName: string; toolId: string; toolInput: Record<string, unknown>; sessionId: string }
  | { type: "tool_result"; toolId: string; content: string; sessionId: string }
  | { type: "result"; success: boolean; cost?: number; duration?: number; sessionId: string }
  | { type: "interrupted"; sessionId: string }
  | { type: "error"; error: string; sessionId?: string };

const API_BASE = "/api";

function getWsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/ws`;
}

export default function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const selectedSessionRef = useRef<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [cliName, setCliName] = useState("claude");
  const [showFiles, setShowFiles] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showSocial, setShowSocial] = useState(false);
  const [showScheduled, setShowScheduled] = useState(false);
  const [showAccountPosts, setShowAccountPosts] = useState(false);
  const [showTrafficDashboard, setShowTrafficDashboard] = useState(false);
  const [showPublish, setShowPublish] = useState(false);
  const [previewFile, setPreviewFile] = useState<{ relativePath: string; sessionId: string } | null>(null);
  const [defaultWorkspace, setDefaultWorkspace] = useState("");
  const [language, setLanguage] = useState<Language>("zh-TW");
  const [theme, setTheme] = useState<Theme>("light");
  const [accounts, setAccounts] = useState<{ id: string; name: string; handle: string; platform: string }[]>([]);
  const [targetAccountId, setTargetAccountId] = useState("");

  // Apply dark class to <html>
  useEffect(() => {
    const isDark =
      theme === "dark" ||
      (theme === "system" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", isDark);
  }, [theme]);

  // Listen for OS theme changes when in "system" mode
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      document.documentElement.classList.toggle("dark", e.matches);
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  // Keep ref in sync for use inside WS callback
  useEffect(() => {
    selectedSessionRef.current = selectedSessionId;
  }, [selectedSessionId]);

  const handleWSMessage = useCallback((message: ServerWSMessage) => {
    // Ignore messages from sessions we're not currently viewing
    const msgSessionId = "sessionId" in message ? message.sessionId : undefined;
    if (msgSessionId && msgSessionId !== selectedSessionRef.current) {
      return;
    }

    switch (message.type) {
      case "connected":
        break;

      case "history": {
        const history = message.messages || [];
        // Merge: use history as base, append any optimistic local messages not in history
        setMessages((prev) => {
          if (prev.length === 0) return history;
          // Find messages added locally after the last history entry
          const historyIds = new Set(history.map((m: { id: string }) => m.id));
          const localOnly = prev.filter((m) => !historyIds.has(m.id));
          return [...history, ...localOnly];
        });
        // Restore loading indicator if the session agent is still running
        if (message.running) {
          setIsLoading(true);
        }
        // Track which CLI is being used
        if (message.cliName) {
          setCliName(message.cliName);
        }
        break;
      }

      case "user_message":
        // Render user messages from other tabs/subscribers
        if (message.content) {
          setMessages((prev) => {
            // Skip if already present (optimistic local insert)
            if (prev.some((m) => m.role === "user" && m.content === message.content &&
              Date.now() - new Date(m.timestamp || 0).getTime() < 5000)) {
              return prev;
            }
            return [...prev, {
              id: crypto.randomUUID(),
              role: "user",
              content: message.content,
              timestamp: new Date().toISOString(),
            }];
          });
        }
        break;

      case "assistant_message":
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: message.content,
            timestamp: new Date().toISOString(),
          },
        ]);
        break;

      case "tool_use":
        setMessages((prev) => [
          ...prev,
          {
            id: `tu_${message.toolId || crypto.randomUUID()}`,
            role: "tool_use",
            content: null,
            timestamp: new Date().toISOString(),
            toolName: message.toolName,
            toolInput: message.toolInput,
            toolId: message.toolId,
          },
        ]);
        break;

      case "tool_result":
        setMessages((prev) => [
          ...prev,
          {
            id: `tr_${message.toolId || crypto.randomUUID()}`,
            role: "tool_result",
            content: message.content,
            timestamp: new Date().toISOString(),
            toolId: message.toolId,
          },
        ]);
        break;

      case "result":
        setIsLoading(false);
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "result",
            content: JSON.stringify({
              success: message.success,
              cost: message.cost,
              duration: message.duration,
            }),
            timestamp: new Date().toISOString(),
          },
        ]);
        fetchSessions();
        break;

      case "interrupted":
        setIsLoading(false);
        break;

      case "error":
        console.error("Server error:", message.error);
        setIsLoading(false);
        break;
    }
  }, []);

  const { sendJsonMessage, readyState, lastJsonMessage } = useWebSocket(getWsUrl, {
    shouldReconnect: () => true,
    reconnectAttempts: 10,
    reconnectInterval: 3000,
  });

  const isConnected = readyState === ReadyState.OPEN;

  // Re-subscribe to the active session after reconnect
  useEffect(() => {
    if (isConnected && selectedSessionRef.current) {
      setIsLoading(false); // reset stale loading state from before disconnect
      sendJsonMessage({ type: "subscribe", sessionId: selectedSessionRef.current });
    }
  }, [isConnected, sendJsonMessage]);

  useEffect(() => {
    if (lastJsonMessage) {
      handleWSMessage(lastJsonMessage as ServerWSMessage);
    }
  }, [lastJsonMessage, handleWSMessage]);

  const fetchSessions = async () => {
    try {
      const res = await fetch(`${API_BASE}/sessions`);
      if (!res.ok) return;
      const data = await res.json();
      setSessions(data);
    } catch {
      // Network error — ignore silently
    }
  };

  const fetchSettings = async () => {
    try {
      const res = await fetch(`${API_BASE}/settings`);
      if (!res.ok) return;
      const data = await res.json();
      setDefaultWorkspace(data.defaultWorkspace || "");
      setLanguage(data.language || "zh-TW");
      if (data.theme) setTheme(data.theme);
    } catch {
      // ignore
    }
  };

  const handleThemeChange = async (newTheme: Theme) => {
    const prev = theme;
    setTheme(newTheme);
    try {
      const res = await fetch(`${API_BASE}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: newTheme }),
      });
      if (!res.ok) throw new Error("Save failed");
    } catch {
      setTheme(prev);
    }
  };

  const handleLanguageChange = async (lang: Language) => {
    const prev = language;
    setLanguage(lang);

    try {
      const res = await fetch(`${API_BASE}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: lang }),
      });
      if (!res.ok) throw new Error("Save failed");
    } catch {
      setLanguage(prev);
      return;
    }

    if (selectedSessionId && messages.length > 0 && isConnected) {
      const SWITCH_MSG: Record<Language, string> = {
        "zh-TW": "[系統] 使用者已將語言切換為繁體中文。從現在起，請用繁體中文（台灣用語）回覆所有訊息。",
        "en": "[System] User switched language to English. From now on, please respond in English for all messages.",
        "ja": "[システム] ユーザーが言語を日本語に切り替えました。これ以降、すべてのメッセージを日本語で回答してください。",
      };
      sendJsonMessage({
        type: "chat",
        content: SWITCH_MSG[lang],
        sessionId: selectedSessionId,
      });
    }
  };

  const createSession = async () => {
    try {
      const res = await fetch(`${API_BASE}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspacePath: defaultWorkspace || undefined }),
      });
      if (!res.ok) return;
      const session = await res.json();
      setSessions((prev) => [session, ...prev]);
      selectSession(session.id);
      setShowSettings(false);
    } catch (error) {
      console.error("Failed to create session:", error);
    }
  };

  const deleteSession = async (sessionId: string) => {
    try {
      const res = await fetch(`${API_BASE}/sessions/${sessionId}`, { method: "DELETE" });
      if (!res.ok) return;
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      if (selectedSessionId === sessionId) {
        setSelectedSessionId(null);
        setMessages([]);
      }
    } catch (error) {
      console.error("Failed to delete session:", error);
    }
  };

  const selectSession = (sessionId: string) => {
    // Update ref BEFORE subscribe so WS message filter accepts the new session
    selectedSessionRef.current = sessionId;
    setSelectedSessionId(sessionId);
    setMessages([]);
    // Don't force isLoading=false here — the server's history response
    // will include a `running` flag to restore loading state correctly
    setIsLoading(false); // temporary until history arrives
    setCliName("claude"); // reset until history arrives with actual cliName
    setShowSettings(false);
    setShowSocial(false);
    setShowScheduled(false);
    setShowAccountPosts(false);
    setShowTrafficDashboard(false);
    if (isConnected) {
      sendJsonMessage({ type: "subscribe", sessionId });
    }
  };

  const handleSendMessage = (content: string) => {
    if (!selectedSessionId || !isConnected) return;

    setMessages((prev) => {
      // Auto-update session title from first user message
      if (prev.length === 0) {
        const title = content.slice(0, 80).replace(/\n/g, " ");
        setSessions((ss) =>
          ss.map((s) => s.id === selectedSessionId ? { ...s, title } : s)
        );
        // Persist title to server (fire-and-forget)
        fetch(`${API_BASE}/sessions/${selectedSessionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        }).catch(() => {});
      }
      return [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "user",
          content,
          timestamp: new Date().toISOString(),
        },
      ];
    });

    setIsLoading(true);

    sendJsonMessage({
      type: "chat",
      content,
      sessionId: selectedSessionId,
    });
  };

  const handleInterrupt = () => {
    if (!selectedSessionId) return;
    sendJsonMessage({
      type: "interrupt",
      sessionId: selectedSessionId,
    });
    setIsLoading(false);
  };

  // Preview a file — accepts absolute or relative path (must be within workspace)
  const handlePreviewFile = (filePath: string) => {
    if (!selectedSessionId) return;
    const session = sessions.find((s) => s.id === selectedSessionId);
    if (filePath.startsWith("/")) {
      // Absolute path — must be within workspace, otherwise reject
      if (!session) return;
      const wsBase = session.workspace_path.replace(/\/$/, "");
      if (!filePath.startsWith(wsBase + "/")) return; // outside workspace, ignore
      const relativePath = filePath.slice(wsBase.length + 1);
      setPreviewFile({ relativePath, sessionId: selectedSessionId });
    } else {
      // Already relative
      setPreviewFile({ relativePath: filePath, sessionId: selectedSessionId });
    }
  };

  // Preview from file explorer (already relative)
  const handleExplorerPreview = (relativePath: string) => {
    if (!selectedSessionId) return;
    setPreviewFile({ relativePath, sessionId: selectedSessionId });
  };

  const fetchAccounts = async () => {
    try {
      const res = await fetch(`${API_BASE}/accounts`);
      if (!res.ok) return;
      const data = await res.json();
      setAccounts(data);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchSessions();
    fetchSettings();
    fetchAccounts();
  }, []);

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-950">
      {/* Sidebar */}
      <div className="w-64 shrink-0">
        <Sidebar
          sessions={sessions}
          selectedSessionId={selectedSessionId}
          onSelectSession={selectSession}
          onNewSession={createSession}
          onDeleteSession={deleteSession}
          onShowSettings={() => { setShowSettings(true); setShowSocial(false); setShowScheduled(false); setShowAccountPosts(false); setShowTrafficDashboard(false); }}
          onShowSocial={() => { setShowSocial(true); setShowSettings(false); setShowScheduled(false); setShowAccountPosts(false); setShowTrafficDashboard(false); }}
          onShowScheduled={() => { setShowScheduled(true); setShowSettings(false); setShowSocial(false); setShowAccountPosts(false); setShowTrafficDashboard(false); }}
          onShowAccountPosts={() => { setShowAccountPosts(true); setShowSettings(false); setShowSocial(false); setShowScheduled(false); setShowTrafficDashboard(false); }}
          onShowTrafficDashboard={() => { setShowTrafficDashboard(true); setShowSettings(false); setShowSocial(false); setShowScheduled(false); setShowAccountPosts(false); }}
          defaultWorkspace={defaultWorkspace}
          isConnected={isConnected}
          language={language}
          onLanguageChange={handleLanguageChange}
          theme={theme}
          onThemeChange={handleThemeChange}
        />
      </div>

      {/* Main content */}
      {showSettings ? (
        <SettingsPage
          isVisible={showSettings}
          onClose={() => setShowSettings(false)}
          language={language}
          onLanguageChange={handleLanguageChange}
        />
      ) : showSocial ? (
        <SocialAccountsPage onClose={() => setShowSocial(false)} language={language} />
      ) : showScheduled ? (
        <ScheduledTasksPage onClose={() => setShowScheduled(false)} language={language} />
      ) : showAccountPosts ? (
        <AccountPostsPage onClose={() => setShowAccountPosts(false)} language={language} />
      ) : showTrafficDashboard ? (
        <TrafficDashboardPage onClose={() => setShowTrafficDashboard(false)} language={language} />
      ) : (
        <>
          <ChatWindow
            sessionId={selectedSessionId}
            messages={messages}
            isConnected={isConnected}
            isLoading={isLoading}
            onSendMessage={handleSendMessage}
            onInterrupt={handleInterrupt}
            onShowFiles={() => setShowFiles(!showFiles)}
            onShowPublish={() => setShowPublish(true)}
            onNewSession={createSession}
            onPreviewFile={handlePreviewFile}
            workspacePath={sessions.find((s) => s.id === selectedSessionId)?.workspace_path}
            showFilesActive={showFiles}
            language={language}
            accounts={accounts}
            targetAccountId={targetAccountId}
            onTargetAccountChange={setTargetAccountId}
            cliName={cliName}
          />

          <FileExplorer
            sessionId={selectedSessionId}
            isVisible={showFiles}
            onToggle={() => setShowFiles(!showFiles)}
            onPreviewFile={handleExplorerPreview}
          />
        </>
      )}

      {/* File preview modal */}
      {previewFile && (
        <FilePreviewModal
          sessionId={previewFile.sessionId}
          filePath={previewFile.relativePath}
          onClose={() => setPreviewFile(null)}
        />
      )}

      {/* Publish dialog */}
      <PublishDialog
        isOpen={showPublish}
        onClose={() => setShowPublish(false)}
        sessionId={selectedSessionId}
      />
    </div>
  );
}
