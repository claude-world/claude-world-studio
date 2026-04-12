/**
 * AgentDashboard — Phase 2+3 agentic overview page.
 *
 * Tabs: Goals | Workflows | Memory | Strategy
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { apiGet, apiPost, apiDelete } from "../hooks/useApi";

/** Safely parse a JSON string, returning fallback on error */
function safeParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface AgentGoal {
  id: string;
  description: string;
  status: "active" | "completed" | "failed" | "paused";
  progress: number;
  sub_tasks: string | null;
  created_at: string;
  updated_at: string;
}

interface AgentMemory {
  id: string;
  content: string;
  memory_type: "general" | "reflection" | "preference" | "failure" | "success";
  tags: string | null;
  access_count: number;
  created_at: string;
}

interface AgentWorkflow {
  id: string;
  name: string;
  description: string | null;
  template: string;
  account_id: string | null;
  tags: string | null;
  is_public: number;
  run_count: number;
  created_at: string;
  updated_at: string;
}

interface StrategyReport {
  period_days: number;
  total_published: number;
  engagement_rate_pct: number;
  top_formats: { format: string; avg_views: number; posts: number }[];
  best_hours: number[];
  topic_seeds: string[];
  recommendations: string[];
  content_calendar: {
    day_label: string;
    hour: number;
    topic_seed: string;
    format: string;
    priority: "high" | "medium" | "low";
  }[];
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: AgentGoal["status"] }) {
  const colors: Record<AgentGoal["status"], string> = {
    active: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
    completed: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
    failed: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
    paused: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
  };
  return (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded capitalize ${colors[status]}`}>
      {status}
    </span>
  );
}

function MemoryTypeBadge({ type }: { type: AgentMemory["memory_type"] }) {
  const colors: Record<AgentMemory["memory_type"], string> = {
    general: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
    reflection: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
    preference: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
    failure: "bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-300",
    success: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  };
  return (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded capitalize ${colors[type]}`}>
      {type}
    </span>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
      <div
        className="h-full bg-blue-500 rounded-full transition-all duration-300"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

// ── Goals Tab ─────────────────────────────────────────────────────────────────

function GoalsTab() {
  const [goals, setGoals] = useState<AgentGoal[]>([]);
  const [filter, setFilter] = useState<"active" | "completed" | "failed" | "paused">("active");
  const [loading, setLoading] = useState(false);
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [data] = await apiGet<AgentGoal[]>(`/agent/goals?status=${filter}&limit=50`);
    if (data) setGoals(data);
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async () => {
    if (!newDesc.trim()) return;
    setCreating(true);
    const [goal] = await apiPost<AgentGoal>("/agent/goals", { description: newDesc.trim() });
    if (goal) {
      setGoals((prev) => [goal, ...prev]);
      setNewDesc("");
    }
    setCreating(false);
  };

  const handleDelete = async (id: string) => {
    await apiDelete(`/agent/goals/${id}`);
    setGoals((prev) => prev.filter((g) => g.id !== id));
  };

  return (
    <div className="space-y-4">
      {/* Create */}
      <div className="flex gap-2">
        <input
          type="text"
          value={newDesc}
          onChange={(e) => setNewDesc(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          placeholder="New goal description..."
          className="flex-1 px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={handleCreate}
          disabled={creating || !newDesc.trim()}
          className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-lg disabled:opacity-50 transition-colors"
        >
          {creating ? "..." : "Add"}
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
        {(["active", "completed", "failed", "paused"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 text-xs font-medium capitalize transition-colors border-b-2 -mb-px ${
              filter === s
                ? "border-blue-500 text-blue-600 dark:text-blue-400"
                : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Goals list */}
      {loading ? (
        <div className="text-xs text-gray-500 dark:text-gray-400">Loading...</div>
      ) : goals.length === 0 ? (
        <div className="text-xs text-gray-500 dark:text-gray-400 py-8 text-center">
          No {filter} goals
        </div>
      ) : (
        <div className="space-y-2">
          {goals.map((goal) => {
            const subTasks = safeParse<{ status: string }[]>(goal.sub_tasks, []);
            return (
              <div
                key={goal.id}
                className="p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900 dark:text-gray-100 leading-snug">
                      {goal.description}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <StatusBadge status={goal.status} />
                      <span className="text-[10px] text-gray-400">{goal.progress}%</span>
                      {subTasks.length > 0 && (
                        <span className="text-[10px] text-gray-400">
                          {subTasks.filter((t: any) => t.status === "completed").length}/
                          {subTasks.length} tasks
                        </span>
                      )}
                    </div>
                    {goal.status === "active" && <ProgressBar value={goal.progress} />}
                  </div>
                  <button
                    onClick={() => handleDelete(goal.id)}
                    className="text-gray-400 hover:text-red-500 transition-colors shrink-0 mt-0.5"
                    title="Delete goal"
                  >
                    <svg
                      className="w-3.5 h-3.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Workflows Tab ─────────────────────────────────────────────────────────────

function WorkflowsTab() {
  const [workflows, setWorkflows] = useState<AgentWorkflow[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", template: "{}", isPublic: false });
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    setLoading(true);
    apiGet<AgentWorkflow[]>("/agent/workflows?limit=50").then(([data]) => {
      if (data) setWorkflows(data);
      setLoading(false);
    });
  }, []);

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    const [wf] = await apiPost<AgentWorkflow>("/agent/workflows", {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      template: form.template,
      isPublic: form.isPublic,
    });
    if (wf) {
      setWorkflows((prev) => [wf, ...prev]);
      setForm({ name: "", description: "", template: "{}", isPublic: false });
      setShowCreate(false);
    }
  };

  const handleDelete = async (id: string) => {
    await apiDelete(`/agent/workflows/${id}`);
    setWorkflows((prev) => prev.filter((w) => w.id !== id));
  };

  const handleExport = (workflow: AgentWorkflow) => {
    const blob = new Blob([JSON.stringify(workflow, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `workflow-${workflow.name.replace(/\s+/g, "-").toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      if (!mountedRef.current) return;
      try {
        const data = JSON.parse(ev.target?.result as string);
        const [wf] = await apiPost<AgentWorkflow>("/agent/workflows", {
          name: `${data.name} (imported)`,
          description: data.description,
          template: data.template,
          isPublic: false,
        });
        if (wf && mountedRef.current) setWorkflows((prev) => [wf, ...prev]);
      } catch {
        // ignore parse/network errors
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
          >
            + New
          </button>
          <label className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg cursor-pointer transition-colors">
            Import
            <input type="file" accept=".json" className="hidden" onChange={handleImport} />
          </label>
        </div>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {workflows.length} templates
        </span>
      </div>

      {showCreate && (
        <div className="p-3 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg space-y-2">
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Workflow name"
            className="w-full px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <input
            type="text"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="Description (optional)"
            className="w-full px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <textarea
            value={form.template}
            onChange={(e) => setForm((f) => ({ ...f, template: e.target.value }))}
            placeholder='Template JSON (e.g. {"steps": []})'
            rows={3}
            className="w-full px-3 py-1.5 text-xs font-mono border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
          />
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={form.isPublic}
                onChange={(e) => setForm((f) => ({ ...f, isPublic: e.target.checked }))}
                className="w-3 h-3"
              />
              Public
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => setShowCreate(false)}
                className="px-3 py-1 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!form.name.trim()}
                className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded disabled:opacity-50 transition-colors"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-xs text-gray-500 dark:text-gray-400">Loading...</div>
      ) : workflows.length === 0 ? (
        <div className="text-xs text-gray-500 dark:text-gray-400 py-8 text-center">
          No workflow templates yet
        </div>
      ) : (
        <div className="space-y-2">
          {workflows.map((wf) => (
            <div
              key={wf.id}
              className="p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {wf.name}
                    </span>
                    {wf.is_public === 1 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
                        public
                      </span>
                    )}
                  </div>
                  {wf.description && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                      {wf.description}
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] text-gray-400">{wf.run_count} runs</span>
                    {wf.tags && (
                      <span className="text-[10px] text-gray-400">
                        {safeParse<string[]>(wf.tags, []).join(", ")}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => handleExport(wf)}
                    className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 transition-colors"
                    title="Export as JSON"
                  >
                    ↓
                  </button>
                  <button
                    onClick={() => handleDelete(wf.id)}
                    className="text-gray-400 hover:text-red-500 transition-colors p-1"
                    title="Delete"
                  >
                    <svg
                      className="w-3.5 h-3.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Memory Tab ────────────────────────────────────────────────────────────────

function MemoryTab() {
  const [memories, setMemories] = useState<AgentMemory[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (q?: string) => {
    setLoading(true);
    const url = q
      ? `/agent/memories?q=${encodeURIComponent(q)}&limit=30`
      : "/agent/memories?limit=30";
    const [data] = await apiGet<AgentMemory[]>(url);
    if (data) setMemories(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    load(query.trim() || undefined);
  };

  const handleDelete = async (id: string) => {
    await apiDelete(`/agent/memories/${id}`);
    setMemories((prev) => prev.filter((m) => m.id !== id));
  };

  const typeCounts = memories.reduce<Record<string, number>>((acc, m) => {
    acc[m.memory_type] = (acc[m.memory_type] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        {Object.entries(typeCounts).map(([type, count]) => (
          <div
            key={type}
            className="p-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-center"
          >
            <div className="text-lg font-bold text-gray-900 dark:text-gray-100">{count}</div>
            <div className="text-[10px] text-gray-500 dark:text-gray-400 capitalize">{type}</div>
          </div>
        ))}
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search memories..."
          className="flex-1 px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="submit"
          className="px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg transition-colors"
        >
          Search
        </button>
      </form>

      {/* List */}
      {loading ? (
        <div className="text-xs text-gray-500 dark:text-gray-400">Loading...</div>
      ) : memories.length === 0 ? (
        <div className="text-xs text-gray-500 dark:text-gray-400 py-8 text-center">
          No memories stored yet
        </div>
      ) : (
        <div className="space-y-2">
          {memories.map((mem) => (
            <div
              key={mem.id}
              className="p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed">
                    {mem.content}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <MemoryTypeBadge type={mem.memory_type} />
                    <span className="text-[10px] text-gray-400">{mem.access_count} accesses</span>
                    {mem.tags && (
                      <span className="text-[10px] text-gray-400">
                        {safeParse<string[]>(mem.tags, []).slice(0, 3).join(", ")}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(mem.id)}
                  className="text-gray-400 hover:text-red-500 transition-colors shrink-0 mt-0.5"
                  title="Delete memory"
                >
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Strategy Tab ──────────────────────────────────────────────────────────────

function StrategyTab() {
  const [report, setReport] = useState<StrategyReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(30);

  const loadStrategy = useCallback(async () => {
    setLoading(true);
    const [data] = await apiGet<StrategyReport>(`/agent/analytics/strategy?days=${days}`);
    if (data) setReport(data);
    setLoading(false);
  }, [days]);

  useEffect(() => {
    loadStrategy();
  }, [loadStrategy]);

  if (loading) {
    return (
      <div className="text-xs text-gray-500 dark:text-gray-400 py-8 text-center">Analyzing...</div>
    );
  }

  if (!report) {
    return (
      <div className="text-xs text-gray-500 dark:text-gray-400 py-8 text-center">
        No analytics data yet — start publishing to generate strategy
      </div>
    );
  }

  const priorityColors = {
    high: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
    medium: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
    low: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
  };

  return (
    <div className="space-y-4">
      {/* Days selector */}
      <div className="flex items-center gap-3">
        <span className="text-xs text-gray-500 dark:text-gray-400">Lookback period</span>
        {[7, 30, 90].map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
              days === d
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300"
            }`}
          >
            {d}d
          </button>
        ))}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2">
        <div className="p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-center">
          <div className="text-lg font-bold text-gray-900 dark:text-gray-100">
            {report.total_published}
          </div>
          <div className="text-[10px] text-gray-500 dark:text-gray-400">Posts</div>
        </div>
        <div className="p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-center">
          <div className="text-lg font-bold text-gray-900 dark:text-gray-100">
            {report.engagement_rate_pct}%
          </div>
          <div className="text-[10px] text-gray-500 dark:text-gray-400">Engagement</div>
        </div>
        <div className="p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-center">
          <div className="text-lg font-bold text-gray-900 dark:text-gray-100">
            {report.best_hours[0] !== undefined ? `${report.best_hours[0]}:00` : "—"}
          </div>
          <div className="text-[10px] text-gray-500 dark:text-gray-400">Best Hour</div>
        </div>
      </div>

      {/* Recommendations */}
      {report.recommendations.length > 0 && (
        <div className="p-3 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg">
          <div className="text-xs font-semibold text-blue-700 dark:text-blue-300 mb-2">
            Recommendations
          </div>
          <ul className="space-y-1">
            {report.recommendations.map((rec, i) => (
              <li
                key={i}
                className="flex items-start gap-1.5 text-xs text-blue-800 dark:text-blue-200"
              >
                <span className="mt-0.5 shrink-0">•</span>
                <span>{rec}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Content calendar */}
      {report.content_calendar.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
            Content Calendar
          </div>
          <div className="space-y-2">
            {report.content_calendar.map((entry, i) => (
              <div
                key={i}
                className="flex items-center gap-3 p-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg"
              >
                <div className="text-center shrink-0 w-16">
                  <div className="text-[10px] font-semibold text-gray-700 dark:text-gray-300">
                    {entry.day_label.slice(0, 3)}
                  </div>
                  <div className="text-[10px] text-gray-500 dark:text-gray-400">
                    {entry.hour}:00
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-700 dark:text-gray-300 truncate">
                    {entry.topic_seed}
                  </p>
                  <span className="text-[10px] text-gray-400">{entry.format}</span>
                </div>
                <span
                  className={`text-[10px] font-medium px-1.5 py-0.5 rounded capitalize shrink-0 ${priorityColors[entry.priority]}`}
                >
                  {entry.priority}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top formats */}
      {report.top_formats.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
            Top Formats
          </div>
          <div className="space-y-1.5">
            {report.top_formats.map((f, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="text-xs text-gray-700 dark:text-gray-300 w-20 capitalize shrink-0">
                  {f.format}
                </span>
                <div className="flex-1">
                  <ProgressBar
                    value={
                      report.top_formats[0]?.avg_views
                        ? (f.avg_views / report.top_formats[0].avg_views) * 100
                        : 0
                    }
                  />
                </div>
                <span className="text-xs text-gray-500 dark:text-gray-400 w-20 text-right shrink-0">
                  {f.avg_views} avg views
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

type DashTab = "goals" | "workflows" | "memory" | "strategy";

interface AgentDashboardProps {
  onClose: () => void;
  language?: string;
}

export function AgentDashboard({ onClose, language = "en" }: AgentDashboardProps) {
  const [activeTab, setActiveTab] = useState<DashTab>("goals");

  const tabs: { id: DashTab; label: string }[] = [
    { id: "goals", label: language === "zh-TW" ? "目標" : "Goals" },
    { id: "workflows", label: language === "zh-TW" ? "工作流" : "Workflows" },
    { id: "memory", label: language === "zh-TW" ? "記憶" : "Memory" },
    { id: "strategy", label: language === "zh-TW" ? "策略" : "Strategy" },
  ];

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center">
            <svg
              className="w-4 h-4 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
              />
            </svg>
          </div>
          <div>
            <h1 className="text-sm font-bold text-gray-900 dark:text-gray-100">Agent Dashboard</h1>
            <p className="text-[10px] text-gray-500 dark:text-gray-400">
              Goals · Workflows · Memory · Strategy
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded transition-colors"
          title="Close"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-6">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab.id
                ? "border-purple-500 text-purple-600 dark:text-purple-400"
                : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === "goals" && <GoalsTab />}
        {activeTab === "workflows" && <WorkflowsTab />}
        {activeTab === "memory" && <MemoryTab />}
        {activeTab === "strategy" && <StrategyTab />}
      </div>
    </div>
  );
}
