import React from "react";
import type { Language } from "../App";

interface Session {
  id: string;
  title: string;
  workspace_path: string;
  created_at: string;
  updated_at: string;
}

const LANGUAGES: { code: Language; flag: string; label: string }[] = [
  { code: "zh-TW", flag: "TW", label: "繁中" },
  { code: "en", flag: "EN", label: "English" },
  { code: "ja", flag: "JA", label: "日本語" },
];

interface SidebarProps {
  sessions: Session[];
  selectedSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onDeleteSession: (id: string) => void;
  onShowSettings: () => void;
  defaultWorkspace: string;
  isConnected: boolean;
  language: Language;
  onLanguageChange: (lang: Language) => void;
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return d.toLocaleDateString();
}

export function Sidebar({
  sessions,
  selectedSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  onShowSettings,
  defaultWorkspace,
  isConnected,
  language,
  onLanguageChange,
}: SidebarProps) {
  return (
    <div className="flex flex-col h-full bg-gray-900 text-white">
      {/* Header */}
      <div className="p-4 border-b border-gray-700">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold">
            CW
          </div>
          <div>
            <h1 className="text-sm font-bold text-gray-200 leading-tight">Claude World Studio</h1>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={`inline-block w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-green-400' : 'bg-red-400'}`} />
              <span className="text-[10px] text-gray-500">
                {isConnected ? 'Connected' : 'Reconnecting...'}
              </span>
            </div>
          </div>
        </div>
        <button
          onClick={onNewSession}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors text-sm font-medium"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Session
        </button>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto">
        {sessions.length === 0 ? (
          <div className="p-4 text-center">
            <div className="text-gray-500 space-y-3 mt-2">
              <p className="text-sm font-medium text-gray-400">Get Started</p>
              <div className="text-xs text-left space-y-2 px-2">
                <div className="flex gap-2">
                  <span className="text-blue-400 font-mono shrink-0">1.</span>
                  <span className="text-gray-400">Click <strong className="text-gray-300">New Session</strong> above</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-blue-400 font-mono shrink-0">2.</span>
                  <span className="text-gray-400">Ask Claude to discover trends</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-blue-400 font-mono shrink-0">3.</span>
                  <span className="text-gray-400">Let it research and create content</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-blue-400 font-mono shrink-0">4.</span>
                  <span className="text-gray-400">Publish directly to Threads/IG</span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-2 space-y-0.5">
            <div className="px-3 py-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
              Sessions
            </div>
            {sessions.map((session) => (
              <div
                key={session.id}
                className={`group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                  selectedSessionId === session.id
                    ? "bg-gray-700"
                    : "hover:bg-gray-800"
                }`}
                onClick={() => onSelectSession(session.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{session.title}</div>
                  <div className="text-[10px] text-gray-500 mt-0.5">
                    {formatTime(session.updated_at)}
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteSession(session.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-600 rounded transition-all text-gray-400 hover:text-white"
                  title="Delete session"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-gray-700 space-y-2.5">
        {/* Language switcher */}
        <div>
          <div className="text-[10px] text-gray-500 uppercase tracking-wider px-1 mb-1.5">
            Language
          </div>
          <div className="flex gap-1">
            {LANGUAGES.map((lang) => (
              <button
                key={lang.code}
                onClick={() => onLanguageChange(lang.code)}
                className={`flex-1 text-[11px] py-1.5 rounded transition-all font-medium ${
                  language === lang.code
                    ? "bg-blue-600 text-white shadow-sm"
                    : "text-gray-400 hover:text-white hover:bg-gray-800"
                }`}
                title={lang.label}
              >
                {lang.flag}
              </button>
            ))}
          </div>
        </div>

        {defaultWorkspace && (
          <div
            className="flex items-center gap-1.5 text-[10px] text-gray-500 truncate px-1"
            title={defaultWorkspace}
          >
            <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            {defaultWorkspace.split("/").slice(-2).join("/")}
          </div>
        )}
        <button
          onClick={onShowSettings}
          className="w-full flex items-center justify-center gap-1.5 text-xs text-gray-400 hover:text-white py-1.5 hover:bg-gray-800 rounded transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Settings
        </button>
      </div>
    </div>
  );
}
