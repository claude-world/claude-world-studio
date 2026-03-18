import React, { useState, useEffect, useCallback } from "react";

interface Account {
  id: string;
  name: string;
  handle: string;
  platform: string;
  token: string;
  user_id: string;
  style: string;
  persona_prompt: string;
  auto_publish: number;
}

interface Post {
  id: string;
  session_id: string | null;
  platform: string;
  account: string;
  content: string;
  image_url: string | null;
  post_id: string | null;
  post_url: string | null;
  status: string;
  created_at: string;
  // enriched fields for pending
  account_name?: string;
  account_handle?: string;
}

interface Insights {
  views: number;
  likes: number;
  replies: number;
  reposts: number;
  quotes: number;
}

type Tab = "accounts" | "review" | "history";

const EMPTY_ACCOUNT: Omit<Account, "id"> = {
  name: "", handle: "", platform: "threads", token: "",
  user_id: "", style: "", persona_prompt: "", auto_publish: 0,
};

// --- Sub-components ---

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    published: "bg-green-100 text-green-700",
    draft: "bg-amber-100 text-amber-700",
    pending: "bg-blue-100 text-blue-700",
    failed: "bg-red-100 text-red-700",
  };
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${styles[status] || "bg-gray-100 text-gray-600"}`}>
      {status}
    </span>
  );
}

function InsightsPanel({ postId }: { postId: string }) {
  const [insights, setInsights] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const fetchInsights = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/publish/history/${postId}/insights`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setInsights(await res.json());
    } catch (e) {
      setError((e as Error).message);
    }
    setLoading(false);
  };

  useEffect(() => { fetchInsights(); }, [postId]);

  if (loading) return <div className="text-xs text-gray-400 py-2">Loading insights...</div>;
  if (error) return <div className="text-xs text-red-500 py-2">Error: {error}</div>;
  if (!insights) return null;

  const metrics = [
    { label: "Views", value: insights.views, icon: "👁" },
    { label: "Likes", value: insights.likes, icon: "❤️" },
    { label: "Replies", value: insights.replies, icon: "💬" },
    { label: "Reposts", value: insights.reposts, icon: "🔁" },
    { label: "Quotes", value: insights.quotes, icon: "📝" },
  ];

  return (
    <div className="flex gap-4 py-2">
      {metrics.map((m) => (
        <div key={m.label} className="text-center">
          <div className="text-lg font-semibold text-gray-800 dark:text-gray-100">{m.value.toLocaleString()}</div>
          <div className="text-[10px] text-gray-500 dark:text-gray-400">{m.icon} {m.label}</div>
        </div>
      ))}
      <button onClick={fetchInsights} className="self-center text-[10px] text-blue-500 hover:text-blue-700 ml-2">Refresh</button>
    </div>
  );
}

function PostRow({ post, showAccount }: { post: Post; showAccount?: boolean }) {
  const [showInsights, setShowInsights] = useState(false);

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {showAccount && post.account_name && (
            <div className="text-[10px] text-gray-400 dark:text-gray-500 mb-1">{post.account_handle || post.account_name}</div>
          )}
          <p className="text-sm text-gray-800 dark:text-gray-100 whitespace-pre-wrap break-words line-clamp-3">
            {post.content}
          </p>
          <div className="flex items-center gap-2 mt-1.5">
            <StatusBadge status={post.status} />
            <span className="text-[10px] text-gray-400">{new Date(post.created_at).toLocaleString()}</span>
            {post.post_url && (
              <a href={post.post_url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-500 hover:underline">View Post</a>
            )}
          </div>
        </div>
        {post.status === "published" && post.post_id && (
          <button
            onClick={() => setShowInsights(!showInsights)}
            className="text-xs px-2 py-1 border border-gray-200 rounded hover:bg-gray-50 text-gray-600 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800 shrink-0"
          >
            {showInsights ? "Hide" : "Insights"}
          </button>
        )}
      </div>
      {showInsights && post.post_id && <InsightsPanel postId={post.id} />}
    </div>
  );
}

// --- Account Edit Form ---

function AccountForm({
  account,
  isNew,
  onSave,
  onCancel,
}: {
  account: Account;
  isNew: boolean;
  onSave: (data: Account) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState(account);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!form.name || !form.handle) return;
    setSaving(true);
    await onSave(form);
    setSaving(false);
  };

  return (
    <div className="p-4 border border-blue-200 dark:border-blue-800 rounded-lg bg-blue-50/30 dark:bg-blue-950/20 space-y-3">
      <div className="text-sm font-medium text-gray-700 dark:text-gray-200">{isNew ? "New Account" : `Edit: ${account.handle}`}</div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">Name *</label>
          <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Claude World Taiwan" className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded text-sm" />
        </div>
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">Handle *</label>
          <input type="text" value={form.handle} onChange={(e) => setForm({ ...form, handle: e.target.value })} placeholder="@your.account" className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded text-sm" />
        </div>
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">Platform *</label>
          <select value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })} className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded text-sm">
            <option value="threads">Threads</option>
            <option value="instagram">Instagram</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">Style</label>
          <input type="text" value={form.style} onChange={(e) => setForm({ ...form, style: e.target.value })} placeholder="tech-educator, futurist..." className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded text-sm" />
        </div>
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">Token {!isNew && "(leave empty to keep current)"}</label>
          <input type="password" value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} placeholder="API token" className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded text-sm font-mono" />
        </div>
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">User ID</label>
          <input type="text" value={form.user_id} onChange={(e) => setForm({ ...form, user_id: e.target.value })} placeholder="your-threads-user-id" className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded text-sm font-mono" />
        </div>
      </div>
      <div>
        <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">Persona Prompt</label>
        <textarea value={form.persona_prompt} onChange={(e) => setForm({ ...form, persona_prompt: e.target.value })} rows={3} placeholder="Instructions for AI to adapt content for this account..." className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded text-sm resize-none" />
      </div>
      <div className="flex gap-2">
        <button onClick={handleSave} disabled={!form.name || !form.handle || saving} className="text-xs px-4 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40">
          {saving ? "Saving..." : isNew ? "Create" : "Update"}
        </button>
        <button onClick={onCancel} className="text-xs px-3 py-1.5 border border-gray-200 rounded hover:bg-gray-50 text-gray-600 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800">Cancel</button>
      </div>
    </div>
  );
}

// --- Main Page ---

export function SocialAccountsPage({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("accounts");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [editing, setEditing] = useState<Account | null>(null);
  const [isNew, setIsNew] = useState(false);

  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Accounts tab filter
  const [platformFilter, setPlatformFilter] = useState<"all" | "threads" | "instagram">("all");

  // Review queue
  const [pendingPosts, setPendingPosts] = useState<Post[]>([]);
  const [reviewFilter, setReviewFilter] = useState<string>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [publishing, setPublishing] = useState(false);

  // History
  const [historyAccount, setHistoryAccount] = useState<string>("all");
  const [posts, setPosts] = useState<Post[]>([]);

  const fetchAccounts = useCallback(() => {
    fetch("/api/accounts").then((r) => r.ok ? r.json() : []).then(setAccounts).catch(() => {});
  }, []);

  const fetchPending = useCallback(() => {
    fetch("/api/publish/pending").then((r) => r.ok ? r.json() : []).then(setPendingPosts).catch(() => {});
  }, []);

  const fetchHistory = useCallback((accountId: string) => {
    const url = accountId === "all"
      ? "/api/publish/history?limit=200"
      : `/api/accounts/${accountId}/posts?limit=200`;
    fetch(url).then((r) => r.ok ? r.json() : []).then(setPosts).catch(() => {});
  }, []);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);
  useEffect(() => { if (tab === "review") fetchPending(); }, [tab, fetchPending]);
  useEffect(() => { if (tab === "history") fetchHistory(historyAccount); }, [tab, historyAccount, fetchHistory]);

  // --- Account actions ---

  const handleSaveAccount = async (data: Account) => {
    const url = isNew ? "/api/accounts" : `/api/accounts/${data.id}`;
    const method = isNew ? "POST" : "PUT";
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        setEditing(null);
        setIsNew(false);
        fetchAccounts();
        setNotice({ type: "success", text: "Account saved." });
      } else {
        const err = await res.json().catch(() => ({}));
        setNotice({ type: "error", text: err.error || "Failed to save account." });
      }
    } catch {
      setNotice({ type: "error", text: "Network error saving account." });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/accounts/${id}`, { method: "DELETE" });
      if (res.ok) fetchAccounts();
    } catch {}
  };

  const handleToggleAutoPublish = async (id: string, current: number) => {
    try {
      const res = await fetch(`/api/accounts/${id}/auto-publish`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auto_publish: !current }),
      });
      if (res.ok) fetchAccounts();
    } catch {}
  };

  // --- Review queue actions ---

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const filteredAccounts = platformFilter === "all" ? accounts : accounts.filter((a) => a.platform === platformFilter);
  const filteredPending = reviewFilter === "all" ? pendingPosts : pendingPosts.filter((p) => p.account === reviewFilter);

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredPending.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredPending.map((p) => p.id)));
    }
  };

  const handleBatchPublish = async () => {
    if (selectedIds.size === 0) return;
    // Only publish IDs visible in the current filter
    const visibleIds = new Set(filteredPending.map((p) => p.id));
    const idsToPublish = [...selectedIds].filter((id) => visibleIds.has(id));
    if (idsToPublish.length === 0) return;
    setPublishing(true);
    try {
      const res = await fetch("/api/publish/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: idsToPublish }),
      });
      if (res.ok) {
        const data = await res.json();
        const succeeded = data.results?.filter((r: any) => r.success).length ?? 0;
        const failed = data.results?.filter((r: any) => !r.success).length ?? 0;
        setNotice({
          type: failed > 0 ? "error" : "success",
          text: `Published ${succeeded}, failed ${failed}`,
        });
      } else {
        const err = await res.json().catch(() => ({}));
        setNotice({ type: "error", text: err.error || "Batch publish failed." });
      }
      setSelectedIds(new Set());
      fetchPending();
    } catch {
      setNotice({ type: "error", text: "Network error during batch publish." });
    }
    setPublishing(false);
  };

  const handleDiscardDraft = async (id: string) => {
    try {
      await fetch(`/api/publish/${id}/discard`, { method: "POST" });
      fetchPending();
    } catch {}
  };

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "accounts", label: "Accounts", count: accounts.length },
    { key: "review", label: "Review Queue", count: pendingPosts.length },
    { key: "history", label: "Post History" },
  ];

  return (
    <div className="flex-1 flex flex-col bg-white dark:bg-gray-900 overflow-y-auto">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between sticky top-0 bg-white dark:bg-gray-900 z-10">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Social Accounts</h2>
          <div className="flex gap-1">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
                  tab === t.key
                    ? "bg-blue-600 text-white"
                    : "text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-800"
                }`}
              >
                {t.label}
                {t.count !== undefined && t.count > 0 && (
                  <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] ${
                    tab === t.key ? "bg-blue-500 text-white" : "bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-400"
                  }`}>
                    {t.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
        <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">Back to Chat</button>
      </div>

      <div className="p-6 max-w-3xl">
        {/* Notice banner */}
        {notice && (
          <div className={`mb-4 px-3 py-2 rounded-lg text-xs flex items-center justify-between ${
            notice.type === "success" ? "bg-green-50 border border-green-200 text-green-700 dark:bg-green-950 dark:border-green-800 dark:text-green-400" : "bg-red-50 border border-red-200 text-red-700 dark:bg-red-950 dark:border-red-800 dark:text-red-400"
          }`}>
            <span>{notice.text}</span>
            <button onClick={() => setNotice(null)} className="text-gray-400 hover:text-gray-600 ml-2">x</button>
          </div>
        )}

        {/* ===== Accounts Tab ===== */}
        {tab === "accounts" && (
          <div className="space-y-4">
            {/* Toolbar: filter pills + add button */}
            <div className="flex items-center justify-between">
              <div className="flex gap-1">
                {(["all", "threads", "instagram"] as const).map((f) => {
                  const count = f === "all" ? accounts.length : accounts.filter((a) => a.platform === f).length;
                  return (
                    <button
                      key={f}
                      onClick={() => setPlatformFilter(f)}
                      className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                        platformFilter === f
                          ? "bg-blue-600 text-white"
                          : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
                      }`}
                    >
                      {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)} ({count})
                    </button>
                  );
                })}
              </div>
              <button
                onClick={() => { setEditing({ id: "", ...EMPTY_ACCOUNT }); setIsNew(true); }}
                className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium"
              >
                + Add Account
              </button>
            </div>

            {filteredAccounts.length === 0 && !editing && (
              <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">
                {accounts.length === 0 ? "No accounts configured yet." : "No accounts match this filter."}
              </p>
            )}

            {filteredAccounts.map((a) => {
              // Server masks tokens: "" = none, "***" = short token, "xxxx...xxxx" = real token
              const hasToken = a.token === "***" || a.token.includes("...");
              const hasUserId = a.user_id !== "";
              const healthColor =
                !hasToken ? "bg-red-500" :
                (a.platform === "threads" && !hasUserId) ? "bg-amber-500" :
                "bg-green-500";

              return (
                <div key={a.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {/* Avatar with health dot */}
                      <div className="relative">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white text-sm font-bold">
                          {a.handle.replace("@", "").charAt(0).toUpperCase()}
                        </div>
                        <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white dark:border-gray-900 ${healthColor}`} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">{a.handle}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${a.platform === "threads" ? "bg-gray-100 text-gray-600" : "bg-pink-50 text-pink-600"}`}>
                            {a.platform}
                          </span>
                          {a.style && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">{a.style}</span>}
                        </div>
                        <div className="text-xs text-gray-400 dark:text-gray-500">{a.name}</div>
                        {/* Persona preview */}
                        {a.persona_prompt ? (
                          <div className="text-xs text-gray-400 dark:text-gray-500 italic mt-0.5 max-w-md truncate">
                            {a.persona_prompt.slice(0, 80)}{a.persona_prompt.length > 80 ? "..." : ""}
                          </div>
                        ) : (
                          <div className="text-[10px] text-amber-500 mt-0.5">No persona configured</div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {/* Auto-publish toggle */}
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500 dark:text-gray-400">Auto-publish</span>
                        <button
                          onClick={() => handleToggleAutoPublish(a.id, a.auto_publish)}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${a.auto_publish ? "bg-green-500" : "bg-gray-300 dark:bg-gray-600"}`}
                        >
                          <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${a.auto_publish ? "translate-x-4" : "translate-x-0.5"}`} />
                        </button>
                      </div>
                      <div className="relative">
                        <button onClick={() => { setEditing({ ...a, token: "" }); setIsNew(false); }} className="text-xs px-2 py-1 border border-gray-200 rounded hover:bg-gray-50 text-gray-600 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800">Edit</button>
                        {!hasToken && (
                          <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 text-white text-[8px] flex items-center justify-center font-bold">!</span>
                        )}
                      </div>
                      <button onClick={() => handleDelete(a.id)} className="text-xs px-2 py-1 text-red-500 hover:bg-red-50 rounded">Delete</button>
                    </div>
                  </div>
                </div>
              );
            })}

            {editing && (
              <AccountForm
                account={editing}
                isNew={isNew}
                onSave={handleSaveAccount}
                onCancel={() => { setEditing(null); setIsNew(false); }}
              />
            )}
          </div>
        )}

        {/* ===== Review Queue Tab ===== */}
        {tab === "review" && (
          <div className="space-y-4">
            {pendingPosts.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-3xl mb-3">&#9989;</div>
                <p className="text-sm text-gray-500 dark:text-gray-400">No posts pending review</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Posts from accounts with auto-publish OFF will appear here</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {/* Account filter */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500 dark:text-gray-400">Filter:</span>
                      <select
                        value={reviewFilter}
                        onChange={(e) => { setReviewFilter(e.target.value); setSelectedIds(new Set()); }}
                        className="text-xs px-2 py-1 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded"
                      >
                        <option value="all">All Accounts</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>{a.handle} ({a.platform})</option>
                        ))}
                      </select>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={filteredPending.length > 0 && selectedIds.size === filteredPending.length}
                        onChange={toggleSelectAll}
                        className="rounded"
                      />
                      Select All ({filteredPending.length})
                    </label>
                  </div>
                  <button
                    onClick={handleBatchPublish}
                    disabled={selectedIds.size === 0 || publishing}
                    className="text-xs px-4 py-1.5 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-40 font-medium"
                  >
                    {publishing ? "Publishing..." : `Publish Selected (${selectedIds.size})`}
                  </button>
                </div>

                <div className="space-y-2">
                  {filteredPending.map((post) => (
                    <div key={post.id} className="flex gap-3 items-start">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(post.id)}
                        onChange={() => toggleSelect(post.id)}
                        className="mt-3 rounded"
                      />
                      <div className="flex-1">
                        <PostRow post={post} showAccount />
                      </div>
                      <button
                        onClick={() => handleDiscardDraft(post.id)}
                        className="mt-2 text-[10px] text-red-400 hover:text-red-600 shrink-0"
                        title="Discard draft"
                      >
                        Discard
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* ===== Post History Tab ===== */}
        {tab === "history" && (
          <div className="space-y-4">
            {/* Account filter */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 dark:text-gray-400">Filter by account:</span>
              <select
                value={historyAccount}
                onChange={(e) => setHistoryAccount(e.target.value)}
                className="text-xs px-2 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded"
              >
                <option value="all">All Accounts</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.handle} ({a.platform})</option>
                ))}
              </select>
              <button onClick={() => fetchHistory(historyAccount)} className="text-xs text-blue-500 hover:text-blue-700">Refresh</button>
            </div>

            {posts.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">No posts yet</p>
            ) : (
              <div className="space-y-2">
                {posts.map((post) => (
                  <PostRow key={post.id} post={post} showAccount={historyAccount === "all"} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
