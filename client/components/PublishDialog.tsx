import React, { useState, useEffect } from "react";

const MAX_CHARS = 500;
const MAX_POLL_OPTION_CHARS = 25;

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

  // Advanced options
  const [imageUrl, setImageUrl] = useState("");
  const [pollEnabled, setPollEnabled] = useState(false);
  const [pollOptions, setPollOptions] = useState(["", ""]);
  const [tag, setTag] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setText(initialText);
    setResult(null);
    setPublishing(false);
    setImageUrl("");
    setPollEnabled(false);
    setPollOptions(["", ""]);
    setTag("");
    setShowAdvanced(false);

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

  // Poll validation
  const validPollOptions = pollOptions.filter((o) => o.trim());
  const isPollValid = !pollEnabled || (validPollOptions.length >= 2 && pollOptions.every((o) => o.length <= MAX_POLL_OPTION_CHARS));
  const hasPollOverLength = pollEnabled && pollOptions.some((o) => o.length > MAX_POLL_OPTION_CHARS);

  // Advanced options badge
  const advancedBadges: string[] = [];
  if (imageUrl.trim()) advancedBadges.push("img");
  if (tag.trim()) advancedBadges.push("tag");
  if (pollEnabled && validPollOptions.length >= 2) advancedBadges.push("poll");

  const handlePublish = async () => {
    if (!text.trim() || !selectedAccountId) return;
    setPublishing(true);
    setResult(null);

    try {
      const res = await fetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: selectedAccountId,
          text,
          sessionId,
          imageUrl: imageUrl.trim() || undefined,
          pollOptions: pollEnabled ? pollOptions.filter((o) => o.trim()).join("|") : undefined,
          tag: tag.trim() || undefined,
        }),
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
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
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

          {/* Advanced Options Toggle */}
          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
            >
              <span className="text-xs">{showAdvanced ? "\u25BC" : "\u25B6"}</span>
              <span>Advanced Options</span>
              {!showAdvanced && advancedBadges.length > 0 && (
                <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                  {advancedBadges.join(" \u00B7 ")}
                </span>
              )}
            </button>
          </div>

          {/* Advanced Options Panel */}
          {showAdvanced && (
            <div className="space-y-4 pl-2 border-l-2 border-gray-100">
              {/* Image URL */}
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">
                  Image URL
                </label>
                <input
                  type="url"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="https://example.com/image.png"
                />
              </div>

              {/* Poll */}
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pollEnabled}
                    onChange={(e) => setPollEnabled(e.target.checked)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  Poll
                </label>
                {pollEnabled && (
                  <div className="space-y-2">
                    {pollOptions.map((opt, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="text-xs text-gray-400 w-4">{String.fromCharCode(65 + i)}</span>
                        <input
                          type="text"
                          value={opt}
                          onChange={(e) => {
                            const next = [...pollOptions];
                            next[i] = e.target.value;
                            setPollOptions(next);
                          }}
                          maxLength={MAX_POLL_OPTION_CHARS}
                          className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder={`Option ${String.fromCharCode(65 + i)}`}
                        />
                        <span className={`text-xs w-8 text-right ${opt.length > MAX_POLL_OPTION_CHARS ? "text-red-500" : "text-gray-400"}`}>
                          {opt.length}/{MAX_POLL_OPTION_CHARS}
                        </span>
                        {pollOptions.length > 2 && (
                          <button
                            type="button"
                            onClick={() => setPollOptions(pollOptions.filter((_, j) => j !== i))}
                            className="text-gray-400 hover:text-red-500 text-sm"
                          >
                            &times;
                          </button>
                        )}
                      </div>
                    ))}
                    {pollOptions.length < 4 && (
                      <button
                        type="button"
                        onClick={() => setPollOptions([...pollOptions, ""])}
                        className="text-xs text-blue-600 hover:text-blue-800"
                      >
                        + Add option
                      </button>
                    )}
                    {pollEnabled && validPollOptions.length < 2 && (
                      <div className="text-xs text-amber-600">At least 2 non-empty options required</div>
                    )}
                  </div>
                )}
              </div>

              {/* Topic Tag */}
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">
                  Topic Tag
                </label>
                <div className="flex items-center gap-1">
                  <span className="text-gray-400 text-sm">#</span>
                  <input
                    type="text"
                    value={tag}
                    onChange={(e) => setTag(e.target.value.replace(/^#/, ""))}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="AI"
                  />
                </div>
              </div>
            </div>
          )}

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
            disabled={!text.trim() || isOverLimit || !selectedAccountId || publishing || !isPollValid}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {publishing ? "Publishing..." : "Publish"}
          </button>
        </div>
      </div>
    </div>
  );
}
