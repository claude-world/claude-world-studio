import React, { useState, useEffect } from "react";

const MAX_CHARS = 500;

interface Account {
  id: string;
  name: string;
  handle: string;
  platform: string;
  style: string;
}

interface PublishDialogProps {
  isOpen: boolean;
  onClose: () => void;
  initialText?: string;
  sessionId?: string | null;
}

export function PublishDialog({
  isOpen,
  onClose,
  initialText = "",
  sessionId,
}: PublishDialogProps) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [text, setText] = useState(initialText);
  const [publishing, setPublishing] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setText(initialText);
    setResult(null);
    setPublishing(false);

    fetch("/api/accounts")
      .then((r) => r.ok ? r.json() : [])
      .then((data: Account[]) => {
        setAccounts(data);
        if (data.length > 0 && !selectedAccountId) {
          setSelectedAccountId(data[0].id);
        }
      })
      .catch(() => setAccounts([]));
  }, [isOpen]);

  if (!isOpen) return null;

  const isOverLimit = text.length > MAX_CHARS;
  const selectedAccount = accounts.find((a) => a.id === selectedAccountId);

  const handlePublish = async () => {
    if (!text.trim() || !selectedAccountId) return;
    setPublishing(true);
    setResult(null);

    try {
      const res = await fetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: selectedAccountId, text, sessionId }),
      });
      const data = await res.json();

      if (data.success) {
        setResult({
          success: true,
          message: `Published! ${data.postUrl ? `URL: ${data.postUrl}` : `ID: ${data.postId}`}`,
        });
      } else {
        setResult({ success: false, message: data.error || "Publish failed" });
      }
    } catch (err) {
      setResult({ success: false, message: (err as Error).message });
    }
    setPublishing(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4">
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <h3 className="font-semibold text-gray-800">Publish to Social</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">&times;</button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4">
          {/* Account selector */}
          {accounts.length === 0 ? (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
              No accounts configured. Add accounts in Settings.
            </div>
          ) : (
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">
                Account
              </label>
              <select
                value={selectedAccountId}
                onChange={(e) => setSelectedAccountId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.handle} ({a.platform}) {a.style ? `- ${a.style}` : ""}
                  </option>
                ))}
              </select>
              {selectedAccount?.style && (
                <div className="text-xs text-gray-400 mt-1">
                  Style: {selectedAccount.style}
                </div>
              )}
            </div>
          )}

          {/* Content */}
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">
              Content
            </label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder="Enter your post content..."
            />
            <div className={`text-xs mt-1 text-right ${isOverLimit ? "text-red-500 font-medium" : "text-gray-400"}`}>
              {text.length} / {MAX_CHARS} chars
            </div>
          </div>

          {/* Result */}
          {result && (
            <div className={`p-3 rounded-lg text-sm ${result.success ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
              {result.message}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-200 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handlePublish}
            disabled={!text.trim() || isOverLimit || !selectedAccountId || publishing}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {publishing ? "Publishing..." : "Publish"}
          </button>
        </div>
      </div>
    </div>
  );
}
