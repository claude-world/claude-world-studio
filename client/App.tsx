import { useState, useEffect, useCallback, useRef, Fragment } from "react";
import useWebSocketImport, { ReadyState } from "react-use-websocket";

// Handle CJS/ESM interop — Vite 8 may double-wrap the default export
const useWebSocket =
  typeof useWebSocketImport === "function"
    ? useWebSocketImport
    : ((useWebSocketImport as Record<string, unknown>).default as typeof useWebSocketImport);
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
import { AgentDashboard } from "./components/AgentDashboard";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { apiGet, apiPost, apiPut, apiPatch, apiDelete } from "./hooks/useApi";
import { LanguageProvider } from "./hooks/useLanguage";

export type Language = "zh-TW" | "en" | "ja";
export type Theme = "light" | "dark" | "system";

/** Active page — single state replaces 5 boolean flags (Claude Code pattern: single source of truth) */
type Page = "chat" | "settings" | "social" | "scheduled" | "posts" | "traffic" | "agent";

interface Session {
  id: string;
  title: string;
  workspace_path: string;
  created_at: string;
  updated_at: string;
}

interface Message {
  id: string;
  role: "user" | "assistant" | "tool_use" | "tool_result" | "result" | "reflection";
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
  reflectionId?: string;
}

/** Discriminated union for server→client WebSocket messages */
type ServerWSMessage =
  | { type: "connected" }
  | { type: "history"; messages: Message[]; sessionId: string; running?: boolean; cliName?: string }
  | { type: "user_message"; content: string; sessionId: string }
  | { type: "assistant_message"; content: string; sessionId: string }
  | {
      type: "tool_use";
      toolName: string;
      toolId: string;
      toolInput: Record<string, unknown>;
      sessionId: string;
    }
  | { type: "tool_result"; toolId: string; content: string; sessionId: string }
  | { type: "result"; success: boolean; cost?: number; duration?: number; sessionId: string }
  | { type: "interrupted"; sessionId: string }
  | { type: "error"; error: string; sessionId?: string }
  | { type: "reflection"; content: string; reflectionId: string; sessionId: string };

function getWsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/ws`;
}

export default function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const selectedSessionRef = useRef<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [cliName, setCliName] = useState("claude");
  const [showFiles, setShowFiles] = useState(false);
  const [activePage, setActivePage] = useState<Page>("chat");
  // Backward-compatible aliases (used by child components)
  const showSettings = activePage === "settings";
  const showSocial = activePage === "social";
  const showScheduled = activePage === "scheduled";
  const showAccountPosts = activePage === "posts";
  const showTrafficDashboard = activePage === "traffic";
  const showAgentDashboard = activePage === "agent";
  const [showPublish, setShowPublish] = useState(false);
  const [previewFile, setPreviewFile] = useState<{
    relativePath: string;
    sessionId: string;
  } | null>(null);
  const [defaultWorkspace, setDefaultWorkspace] = useState("");
  const [language, setLanguage] = useState<Language>("zh-TW");
  const [theme, setTheme] = useState<Theme>("light");
  const [accounts, setAccounts] = useState<
    { id: string; name: string; handle: string; platform: string }[]
  >([]);
  const [targetAccountId, setTargetAccountId] = useState("");

  // Apply dark class to <html>
  useEffect(() => {
    const isDark =
      theme === "dark" ||
      (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
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

  // Data fetching — declared before handleWSMessage which references fetchSessions
  const fetchSessions = async () => {
    const [data] = await apiGet<Session[]>("/sessions");
    if (data) setSessions(data);
    setSessionsLoading(false);
  };

  const fetchSettings = async () => {
    const [data] = await apiGet<Record<string, string>>("/settings");
    if (!data) return;
    setDefaultWorkspace(data.defaultWorkspace || "");
    setLanguage((data.language as Language) || "zh-TW");
    if (data.theme) setTheme(data.theme as Theme);
  };

  const fetchAccounts = async () => {
    const [data] =
      await apiGet<{ id: string; name: string; handle: string; platform: string }[]>("/accounts");
    if (data) setAccounts(data);
  };

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
            if (
              prev.some(
                (m) =>
                  m.role === "user" &&
                  m.content === message.content &&
                  Date.now() - new Date(m.timestamp || 0).getTime() < 5000
              )
            ) {
              return prev;
            }
            return [
              ...prev,
              {
                id: crypto.randomUUID(),
                role: "user",
                content: message.content,
                timestamp: new Date().toISOString(),
              },
            ];
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

      case "reflection":
        setMessages((prev) => [
          ...prev,
          {
            id: `ref_${message.reflectionId || crypto.randomUUID()}`,
            role: "reflection",
            content: message.content,
            reflectionId: message.reflectionId,
            timestamp: new Date().toISOString(),
          },
        ]);
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

  const handleThemeChange = async (newTheme: Theme) => {
    const prev = theme;
    setTheme(newTheme);
    const [, err] = await apiPut("/settings", { theme: newTheme });
    if (err) setTheme(prev);
  };

  const handleLanguageChange = async (lang: Language) => {
    const prev = language;
    setLanguage(lang);
    const [, err] = await apiPut("/settings", { language: lang });
    if (err) {
      setLanguage(prev);
      return;
    }

    if (selectedSessionId && messages.length > 0 && isConnected) {
      const SWITCH_MSG: Record<Language, string> = {
        "zh-TW":
          "[系統] 使用者已將語言切換為繁體中文。從現在起，請用繁體中文（台灣用語）回覆所有訊息。",
        en: "[System] User switched language to English. From now on, please respond in English for all messages.",
        ja: "[システム] ユーザーが言語を日本語に切り替えました。これ以降、すべてのメッセージを日本語で回答してください。",
      };
      sendJsonMessage({
        type: "chat",
        content: SWITCH_MSG[lang],
        sessionId: selectedSessionId,
      });
    }
  };

  const createSession = async () => {
    const [session, err] = await apiPost<Session>("/sessions", {
      workspacePath: defaultWorkspace || undefined,
    });

    // If the stored workspace path no longer exists, retry without it and clear
    // the stale setting so the user doesn't hit this repeatedly.
    if (err?.status === 400 && err.message.includes("does not exist")) {
      setDefaultWorkspace("");
      const [retrySession, retryErr] = await apiPost<Session>("/sessions", {});
      if (retryErr || !retrySession) return;
      setSessions((prev) => [retrySession, ...prev]);
      selectSession(retrySession.id);
      setActivePage("chat");
      return;
    }

    if (err || !session) return;
    setSessions((prev) => [session, ...prev]);
    selectSession(session.id);
    setActivePage("chat");
  };

  const deleteSession = async (sessionId: string) => {
    const [, err] = await apiDelete(`/sessions/${sessionId}`);
    if (err) return;
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    if (selectedSessionId === sessionId) {
      setSelectedSessionId(null);
      setMessages([]);
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
    setActivePage("chat");
    setSidebarOpen(false); // close mobile overlay when switching sessions
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
        setSessions((ss) => ss.map((s) => (s.id === selectedSessionId ? { ...s, title } : s)));
        // Persist title to server (fire-and-forget)
        apiPatch(`/sessions/${selectedSessionId}`, { title });
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

  useEffect(() => {
    fetchSessions();
    fetchSettings();
    fetchAccounts();
  }, []);

  const sidebarContent = (
    <Sidebar
      sessions={sessions}
      selectedSessionId={selectedSessionId}
      onSelectSession={(id) => {
        selectSession(id);
        setSidebarOpen(false);
      }}
      onNewSession={() => {
        createSession();
        setSidebarOpen(false);
      }}
      onDeleteSession={deleteSession}
      onShowSettings={() => {
        setActivePage("settings");
        setSidebarOpen(false);
      }}
      onShowSocial={() => {
        setActivePage("social");
        setSidebarOpen(false);
      }}
      onShowScheduled={() => {
        setActivePage("scheduled");
        setSidebarOpen(false);
      }}
      onShowAccountPosts={() => {
        setActivePage("posts");
        setSidebarOpen(false);
      }}
      onShowTrafficDashboard={() => {
        setActivePage("traffic");
        setSidebarOpen(false);
      }}
      onShowAgentDashboard={() => {
        setActivePage("agent");
        setSidebarOpen(false);
      }}
      defaultWorkspace={defaultWorkspace}
      isConnected={isConnected}
      language={language}
      onLanguageChange={handleLanguageChange}
      theme={theme}
      onThemeChange={handleThemeChange}
      sessionsLoading={sessionsLoading}
    />
  );

  return (
    <LanguageProvider value={language}>
      <div className="flex h-screen bg-gray-50 dark:bg-gray-950">
        {/* Mobile hamburger button */}
        <button
          className="md:hidden fixed top-3 left-3 z-50 p-2 bg-gray-800 text-white rounded-lg"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          aria-label="Toggle sidebar"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d={sidebarOpen ? "M6 18L18 6M6 6l12 12" : "M4 6h16M4 12h16M4 18h16"}
            />
          </svg>
        </button>

        {/* Sidebar - desktop (always visible) */}
        <div className="hidden md:flex w-64 shrink-0 overflow-hidden">
          <ErrorBoundary name="Sidebar">{sidebarContent}</ErrorBoundary>
        </div>

        {/* Sidebar - mobile overlay */}
        {sidebarOpen && (
          <Fragment>
            <div
              className="md:hidden fixed inset-0 z-40 bg-black/50"
              onClick={() => setSidebarOpen(false)}
            />
            <div className="md:hidden fixed inset-y-0 left-0 z-40 w-64 flex">
              <ErrorBoundary name="Sidebar">{sidebarContent}</ErrorBoundary>
            </div>
          </Fragment>
        )}

        {/* Main content */}
        <div className="flex-1 flex min-w-0" role="main">
          {showSettings ? (
            <ErrorBoundary name="Settings">
              <SettingsPage
                isVisible={showSettings}
                onClose={() => setActivePage("chat")}
                language={language}
                onLanguageChange={handleLanguageChange}
              />
            </ErrorBoundary>
          ) : showSocial ? (
            <ErrorBoundary name="SocialAccounts">
              <SocialAccountsPage onClose={() => setActivePage("chat")} language={language} />
            </ErrorBoundary>
          ) : showScheduled ? (
            <ErrorBoundary name="ScheduledTasks">
              <ScheduledTasksPage onClose={() => setActivePage("chat")} language={language} />
            </ErrorBoundary>
          ) : showAccountPosts ? (
            <ErrorBoundary name="AccountPosts">
              <AccountPostsPage onClose={() => setActivePage("chat")} language={language} />
            </ErrorBoundary>
          ) : showTrafficDashboard ? (
            <ErrorBoundary name="TrafficDashboard">
              <TrafficDashboardPage onClose={() => setActivePage("chat")} language={language} />
            </ErrorBoundary>
          ) : showAgentDashboard ? (
            <ErrorBoundary name="AgentDashboard">
              <AgentDashboard onClose={() => setActivePage("chat")} language={language} />
            </ErrorBoundary>
          ) : (
            <ErrorBoundary name="Chat">
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

                {/* FileExplorer - hidden on mobile, visible on md+ when toggled */}
                <div className="hidden md:contents">
                  <FileExplorer
                    sessionId={selectedSessionId}
                    isVisible={showFiles}
                    onToggle={() => setShowFiles(!showFiles)}
                    onPreviewFile={handleExplorerPreview}
                  />
                </div>
              </>
            </ErrorBoundary>
          )}
        </div>

        {/* File preview modal */}
        {previewFile && (
          <ErrorBoundary name="FilePreview" fallback={null}>
            <FilePreviewModal
              sessionId={previewFile.sessionId}
              filePath={previewFile.relativePath}
              onClose={() => setPreviewFile(null)}
            />
          </ErrorBoundary>
        )}

        {/* Publish dialog */}
        <ErrorBoundary name="PublishDialog" fallback={null}>
          <PublishDialog
            isOpen={showPublish}
            onClose={() => setShowPublish(false)}
            sessionId={selectedSessionId}
          />
        </ErrorBoundary>
      </div>
    </LanguageProvider>
  );
}
