import type { WebSocket } from "ws";

export interface WSClient extends WebSocket {
  sessionId?: string;
  isAlive?: boolean;
}

export interface Session {
  id: string;
  title: string;
  workspace_path: string;
  created_at: string;
  updated_at: string;
  status: string;
}

export interface Message {
  id: string;
  session_id: string;
  role: "user" | "assistant" | "tool_use" | "tool_result" | "result";
  content: string | null;
  tool_name: string | null;
  tool_id: string | null;
  tool_input: string | null;
  cost_usd: number | null;
  created_at: string;
}

export type Language = "zh-TW" | "en" | "ja";

export type Platform = "threads" | "instagram";

export interface SocialAccount {
  id: string;
  name: string;
  handle: string;
  platform: Platform;
  token: string;
  user_id: string;
  style: string;
  persona_prompt: string;
  auto_publish: number; // 0 = manual review, 1 = auto publish
  created_at: string;
}

export type Theme = "light" | "dark" | "system";
export type CfBrowserMode = "cf-api" | "worker";

export interface Settings {
  language: Language;
  theme: Theme;
  cfBrowserMode: CfBrowserMode;
  trendPulseVenvPython: string;
  cfBrowserVenvPython: string;
  notebooklmServerPath: string;
  cfBrowserUrl: string;
  cfBrowserApiKey: string;
  cfAccountId: string;
  cfApiToken: string;
  defaultWorkspace: string;
}

export interface PublishRecord {
  id: string;
  session_id: string | null;
  platform: string;
  account: string;
  content: string;
  image_url: string | null;
  post_id: string | null;
  post_url: string | null;
  status: string; // "draft" | "pending" | "published" | "failed"
  created_at: string;
}

export interface PostInsights {
  views: number;
  likes: number;
  replies: number;
  reposts: number;
  quotes: number;
}

export interface WSChatMessage {
  type: "chat";
  content: string;
  sessionId: string;
}

export interface WSSubscribeMessage {
  type: "subscribe";
  sessionId: string;
}

export interface WSInterruptMessage {
  type: "interrupt";
  sessionId: string;
}

export type IncomingWSMessage =
  | WSChatMessage
  | WSSubscribeMessage
  | WSInterruptMessage;
