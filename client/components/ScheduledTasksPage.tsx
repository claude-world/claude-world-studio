import React, { useState, useEffect, useCallback } from "react";

// --- i18n ---

const T = {
  "zh-TW": {
    pageTitle: "排程任務",
    tabTasks: "任務",
    tabExecutions: "執行紀錄",
    backToChat: "返回對話",
    // Tasks tab
    addTask: "+ 新增任務",
    noTasks: "尚無排程任務。建立一個開始自動化內容產線。",
    enabled: "已啟用",
    disabled: "已停用",
    runNow: "立即執行",
    running: "執行中...",
    edit: "編輯",
    delete: "刪除",
    minScore: "最低分",
    autoPublish: "自動發佈",
    // Task form
    newTask: "新增排程任務",
    editTask: "編輯任務：",
    fieldName: "任務名稱 *",
    fieldAccount: "目標帳號 *",
    fieldSchedule: "排程 *",
    fieldTimezone: "時區",
    fieldPromptTemplate: "提示詞模板 *",
    fieldMinScore: "最低分數",
    fieldMaxRetries: "最大重試",
    fieldTimeout: "逾時（秒）",
    promptHelp: "可用變數：{{account_name}}, {{account_handle}}, {{date}}, {{date_local}}, {{day_of_week}}, {{language}}, {{platform}}",
    saving: "儲存中...",
    create: "建立",
    update: "更新",
    cancel: "取消",
    taskSaved: "任務已儲存。",
    taskSaveFailed: "儲存任務失敗。",
    taskDeleted: "任務已刪除。",
    taskRunStarted: "任務已開始執行。",
    taskRunFailed: "觸發任務失敗。",
    taskAlreadyRunning: "任務已在執行中。",
    // Schedule presets
    schedulePresets: "常用排程",
    every6h: "每 6 小時",
    daily9am: "每天 9:00",
    daily9am9pm: "每天 9:00 + 21:00",
    weeklyMon: "每週一 10:00",
    custom: "自訂 cron",
    // Executions tab
    filterAll: "全部",
    filterByTask: "篩選任務：",
    filterByStatus: "篩選狀態：",
    allTasks: "所有任務",
    allStatuses: "所有狀態",
    noExecutions: "尚無執行紀錄。",
    statusRunning: "執行中",
    statusCompleted: "完成",
    statusPublished: "已發佈",
    statusFailed: "失敗",
    statusRejected: "未達標",
    triggeredBy: "觸發方式",
    triggerSchedule: "排程",
    triggerManual: "手動",
    score: "分數",
    cost: "費用",
    duration: "耗時",
    showContent: "展開內容",
    hideContent: "收合",
    scoreBreakdown: "評分細項",
    error: "錯誤",
    refresh: "重新整理",
  },
  en: {
    pageTitle: "Scheduled Tasks",
    tabTasks: "Tasks",
    tabExecutions: "Executions",
    backToChat: "Back to Chat",
    addTask: "+ New Task",
    noTasks: "No scheduled tasks yet. Create one to automate your content pipeline.",
    enabled: "Enabled",
    disabled: "Disabled",
    runNow: "Run Now",
    running: "Running...",
    edit: "Edit",
    delete: "Delete",
    minScore: "Min Score",
    autoPublish: "Auto-publish",
    newTask: "New Scheduled Task",
    editTask: "Edit Task: ",
    fieldName: "Task Name *",
    fieldAccount: "Target Account *",
    fieldSchedule: "Schedule *",
    fieldTimezone: "Timezone",
    fieldPromptTemplate: "Prompt Template *",
    fieldMinScore: "Min Score",
    fieldMaxRetries: "Max Retries",
    fieldTimeout: "Timeout (seconds)",
    promptHelp: "Variables: {{account_name}}, {{account_handle}}, {{date}}, {{date_local}}, {{day_of_week}}, {{language}}, {{platform}}",
    saving: "Saving...",
    create: "Create",
    update: "Update",
    cancel: "Cancel",
    taskSaved: "Task saved.",
    taskSaveFailed: "Failed to save task.",
    taskDeleted: "Task deleted.",
    taskRunStarted: "Task execution started.",
    taskRunFailed: "Failed to trigger task.",
    taskAlreadyRunning: "Task is already running.",
    schedulePresets: "Presets",
    every6h: "Every 6 hours",
    daily9am: "Daily 9 AM",
    daily9am9pm: "Daily 9 AM + 9 PM",
    weeklyMon: "Monday 10 AM",
    custom: "Custom cron",
    filterAll: "All",
    filterByTask: "Filter by task:",
    filterByStatus: "Filter by status:",
    allTasks: "All Tasks",
    allStatuses: "All Statuses",
    noExecutions: "No executions yet.",
    statusRunning: "Running",
    statusCompleted: "Completed",
    statusPublished: "Published",
    statusFailed: "Failed",
    statusRejected: "Rejected",
    triggeredBy: "Triggered by",
    triggerSchedule: "Schedule",
    triggerManual: "Manual",
    score: "Score",
    cost: "Cost",
    duration: "Duration",
    showContent: "Show Content",
    hideContent: "Hide",
    scoreBreakdown: "Score Breakdown",
    error: "Error",
    refresh: "Refresh",
  },
  ja: {
    pageTitle: "スケジュールタスク",
    tabTasks: "タスク",
    tabExecutions: "実行履歴",
    backToChat: "チャットに戻る",
    addTask: "+ 新規タスク",
    noTasks: "スケジュールタスクがまだありません。コンテンツパイプラインを自動化するために作成してください。",
    enabled: "有効",
    disabled: "無効",
    runNow: "今すぐ実行",
    running: "実行中...",
    edit: "編集",
    delete: "削除",
    minScore: "最低スコア",
    autoPublish: "自動投稿",
    newTask: "新規スケジュールタスク",
    editTask: "タスク編集：",
    fieldName: "タスク名 *",
    fieldAccount: "対象アカウント *",
    fieldSchedule: "スケジュール *",
    fieldTimezone: "タイムゾーン",
    fieldPromptTemplate: "プロンプトテンプレート *",
    fieldMinScore: "最低スコア",
    fieldMaxRetries: "最大リトライ",
    fieldTimeout: "タイムアウト（秒）",
    promptHelp: "変数：{{account_name}}, {{account_handle}}, {{date}}, {{date_local}}, {{day_of_week}}, {{language}}, {{platform}}",
    saving: "保存中...",
    create: "作成",
    update: "更新",
    cancel: "キャンセル",
    taskSaved: "タスクを保存しました。",
    taskSaveFailed: "タスクの保存に失敗しました。",
    taskDeleted: "タスクを削除しました。",
    taskRunStarted: "タスクの実行を開始しました。",
    taskRunFailed: "タスクの開始に失敗しました。",
    taskAlreadyRunning: "タスクはすでに実行中です。",
    schedulePresets: "プリセット",
    every6h: "6時間ごと",
    daily9am: "毎日 9:00",
    daily9am9pm: "毎日 9:00 + 21:00",
    weeklyMon: "毎週月曜 10:00",
    custom: "カスタム cron",
    filterAll: "すべて",
    filterByTask: "タスクでフィルター：",
    filterByStatus: "ステータスでフィルター：",
    allTasks: "すべてのタスク",
    allStatuses: "すべてのステータス",
    noExecutions: "実行履歴はまだありません。",
    statusRunning: "実行中",
    statusCompleted: "完了",
    statusPublished: "投稿済み",
    statusFailed: "失敗",
    statusRejected: "基準未達",
    triggeredBy: "トリガー",
    triggerSchedule: "スケジュール",
    triggerManual: "手動",
    score: "スコア",
    cost: "コスト",
    duration: "所要時間",
    showContent: "コンテンツを表示",
    hideContent: "非表示",
    scoreBreakdown: "スコア内訳",
    error: "エラー",
    refresh: "更新",
  },
};

type LangKey = keyof typeof T;
type Translations = typeof T[LangKey];

interface Account {
  id: string;
  name: string;
  handle: string;
  platform: string;
}

interface ScheduledTask {
  id: string;
  name: string;
  account_id: string;
  prompt_template: string;
  schedule: string;
  timezone: string;
  enabled: number;
  min_score: number;
  max_retries: number;
  timeout_ms: number;
  auto_publish: number;
  created_at: string;
  updated_at: string;
}

interface TaskExecution {
  id: string;
  task_id: string;
  account_id: string;
  status: string;
  prompt: string;
  content: string | null;
  score: number | null;
  score_breakdown: string | null;
  cost_usd: number | null;
  duration_ms: number | null;
  publish_record_id: string | null;
  error: string | null;
  retry_count: number;
  triggered_by: string;
  started_at: string;
  completed_at: string | null;
}

type Tab = "tasks" | "executions";

const SCHEDULE_PRESETS = [
  { label: "every6h", value: "0 */6 * * *" },
  { label: "daily9am", value: "0 9 * * *" },
  { label: "daily9am9pm", value: "0 9,21 * * *" },
  { label: "weeklyMon", value: "0 10 * * 1" },
  { label: "custom", value: "" },
] as const;

const EMPTY_TASK: Omit<ScheduledTask, "id" | "created_at" | "updated_at"> = {
  name: "",
  account_id: "",
  prompt_template: "Discover today's top trending topic in {{platform}}, write an engaging post for {{account_name}} ({{account_handle}}), and publish it.\n\nDate: {{date_local}} ({{day_of_week}})\nLanguage: {{language}}",
  schedule: "0 9 * * *",
  timezone: "Asia/Taipei",
  enabled: 1,
  min_score: 80,
  max_retries: 2,
  timeout_ms: 300000,
  auto_publish: 1,
};

// --- Sub-components ---

function StatusBadge({ status, t }: { status: string; t: Translations }) {
  const styles: Record<string, string> = {
    running: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
    completed: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
    published: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
    failed: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
    rejected: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  };
  const labels: Record<string, string> = {
    running: t.statusRunning,
    completed: t.statusCompleted,
    published: t.statusPublished,
    failed: t.statusFailed,
    rejected: t.statusRejected,
  };
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${styles[status] || "bg-gray-100 text-gray-600"}`}>
      {labels[status] || status}
    </span>
  );
}

function ScoreBadge({ score, minScore }: { score: number | null; minScore?: number }) {
  if (score === null) return null;
  const color = score >= 80 ? "text-green-600 dark:text-green-400" :
    score >= 70 ? "text-amber-600 dark:text-amber-400" :
    "text-red-600 dark:text-red-400";
  const passed = minScore ? score >= minScore : true;
  return (
    <span className={`text-xs font-semibold ${color}`}>
      {score}
      {minScore && !passed && <span className="text-[10px] text-red-500 ml-0.5">/{minScore}</span>}
    </span>
  );
}

function cronToHuman(cron: string): string {
  const parts = cron.split(" ");
  if (parts.length !== 5) return cron;
  const [min, hour, , , dow] = parts;

  if (hour === "*/6" && min === "0") return "Every 6h";
  if (hour === "9" && min === "0" && dow === "*") return "Daily 9:00";
  if (hour === "9,21" && min === "0") return "Daily 9:00 + 21:00";
  if (dow === "1" && min === "0") return `Mon ${hour}:00`;
  return cron;
}

// --- Task Form ---

function TaskForm({
  task,
  isNew,
  accounts,
  onSave,
  onCancel,
  t,
}: {
  task: ScheduledTask;
  isNew: boolean;
  accounts: Account[];
  onSave: (data: any) => Promise<void>;
  onCancel: () => void;
  t: Translations;
}) {
  const [form, setForm] = useState({
    ...task,
    timeout_s: Math.round(task.timeout_ms / 1000),
  });
  const [saving, setSaving] = useState(false);
  const [presetKey, setPresetKey] = useState<string>(() => {
    const match = SCHEDULE_PRESETS.find((p) => p.value === task.schedule);
    return match ? match.label : "custom";
  });

  const handlePreset = (key: string, value: string) => {
    setPresetKey(key);
    if (value) setForm({ ...form, schedule: value });
  };

  const handleSave = async () => {
    if (!form.name || !form.account_id || !form.prompt_template || !form.schedule) return;
    setSaving(true);
    await onSave({
      ...form,
      timeout_ms: form.timeout_s * 1000,
    });
    setSaving(false);
  };

  return (
    <div className="p-4 border border-blue-200 dark:border-blue-800 rounded-lg bg-blue-50/30 dark:bg-blue-950/20 space-y-3">
      <div className="text-sm font-medium text-gray-700 dark:text-gray-200">
        {isNew ? t.newTask : `${t.editTask}${task.name}`}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">{t.fieldName}</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Daily Tech Trends"
            className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">{t.fieldAccount}</label>
          <select
            value={form.account_id}
            onChange={(e) => setForm({ ...form, account_id: e.target.value })}
            className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded text-sm"
          >
            <option value="">--</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.handle} ({a.platform})</option>
            ))}
          </select>
        </div>
      </div>

      {/* Schedule */}
      <div>
        <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">{t.fieldSchedule}</label>
        <div className="flex gap-1 mb-2">
          {SCHEDULE_PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => handlePreset(p.label, p.value)}
              className={`text-[11px] px-2 py-1 rounded-full font-medium transition-colors ${
                presetKey === p.label
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
              }`}
            >
              {t[p.label as keyof Translations] as string}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={form.schedule}
          onChange={(e) => { setForm({ ...form, schedule: e.target.value }); setPresetKey("custom"); }}
          placeholder="0 9 * * *"
          className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded text-sm font-mono"
        />
      </div>

      {/* Timezone */}
      <div>
        <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">{t.fieldTimezone}</label>
        <input
          type="text"
          value={form.timezone}
          onChange={(e) => setForm({ ...form, timezone: e.target.value })}
          placeholder="Asia/Taipei"
          className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded text-sm"
        />
      </div>

      {/* Prompt template */}
      <div>
        <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">{t.fieldPromptTemplate}</label>
        <textarea
          value={form.prompt_template}
          onChange={(e) => setForm({ ...form, prompt_template: e.target.value })}
          rows={4}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded text-sm resize-none font-mono"
        />
        <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">{t.promptHelp}</p>
      </div>

      {/* Settings row */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">{t.fieldMinScore}</label>
          <input
            type="number"
            value={form.min_score}
            onChange={(e) => setForm({ ...form, min_score: parseInt(e.target.value) || 80 })}
            min={0} max={100}
            className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">{t.fieldMaxRetries}</label>
          <input
            type="number"
            value={form.max_retries}
            onChange={(e) => setForm({ ...form, max_retries: parseInt(e.target.value) || 2 })}
            min={0} max={5}
            className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">{t.fieldTimeout}</label>
          <input
            type="number"
            value={form.timeout_s}
            onChange={(e) => setForm({ ...form, timeout_s: parseInt(e.target.value) || 300 })}
            min={60} max={1800}
            className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded text-sm"
          />
        </div>
      </div>

      {/* Auto-publish toggle */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500 dark:text-gray-400">{t.autoPublish}</span>
        <button
          onClick={() => setForm({ ...form, auto_publish: form.auto_publish ? 0 : 1 })}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${form.auto_publish ? "bg-green-500" : "bg-gray-300 dark:bg-gray-600"}`}
        >
          <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${form.auto_publish ? "translate-x-4" : "translate-x-0.5"}`} />
        </button>
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={!form.name || !form.account_id || !form.prompt_template || !form.schedule || saving}
          className="text-xs px-4 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40"
        >
          {saving ? t.saving : isNew ? t.create : t.update}
        </button>
        <button
          onClick={onCancel}
          className="text-xs px-3 py-1.5 border border-gray-200 rounded hover:bg-gray-50 text-gray-600 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800"
        >
          {t.cancel}
        </button>
      </div>
    </div>
  );
}

// --- Execution Row ---

function ExecutionRow({ execution, taskName, accountHandle, t }: {
  execution: TaskExecution;
  taskName?: string;
  accountHandle?: string;
  t: Translations;
}) {
  const [expanded, setExpanded] = useState(false);

  const breakdown = execution.score_breakdown ? (() => {
    try { return JSON.parse(execution.score_breakdown!); } catch { return null; }
  })() : null;

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <StatusBadge status={execution.status} t={t} />
          {taskName && <span className="text-xs text-gray-600 dark:text-gray-300 font-medium truncate">{taskName}</span>}
          {accountHandle && <span className="text-[10px] text-gray-400 dark:text-gray-500">{accountHandle}</span>}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <ScoreBadge score={execution.score} />
          {execution.cost_usd !== null && (
            <span className="text-[10px] text-gray-400">${execution.cost_usd.toFixed(4)}</span>
          )}
          {execution.duration_ms !== null && (
            <span className="text-[10px] text-gray-400">{(execution.duration_ms / 1000).toFixed(0)}s</span>
          )}
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${
            execution.triggered_by === "manual"
              ? "bg-purple-100 text-purple-600 dark:bg-purple-900 dark:text-purple-300"
              : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
          }`}>
            {execution.triggered_by === "manual" ? t.triggerManual : t.triggerSchedule}
          </span>
          <span className="text-[10px] text-gray-400">{new Date(execution.started_at).toLocaleString()}</span>
        </div>
      </div>

      {/* Expand/collapse */}
      {(execution.content || execution.error || breakdown) && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-[10px] text-blue-500 hover:text-blue-700 mt-1.5"
        >
          {expanded ? t.hideContent : t.showContent}
        </button>
      )}

      {expanded && (
        <div className="mt-2 space-y-2">
          {execution.content && (
            <div className="p-2 bg-gray-50 dark:bg-gray-800 rounded text-sm text-gray-700 dark:text-gray-200 whitespace-pre-wrap break-words">
              {execution.content}
            </div>
          )}
          {breakdown && (
            <div className="p-2 bg-gray-50 dark:bg-gray-800 rounded">
              <div className="text-[10px] text-gray-500 dark:text-gray-400 mb-1 font-medium">{t.scoreBreakdown}</div>
              <div className="flex gap-4 text-xs">
                {Object.entries(breakdown).map(([key, val]) => (
                  <div key={key} className="text-center">
                    <div className="font-semibold text-gray-700 dark:text-gray-200">{val as number}</div>
                    <div className="text-[9px] text-gray-400">{key.replace(/_/g, " ")}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {execution.error && (
            <div className="p-2 bg-red-50 dark:bg-red-950 rounded text-xs text-red-600 dark:text-red-400">
              <span className="font-medium">{t.error}: </span>{execution.error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// --- Main Page ---

export function ScheduledTasksPage({ onClose, language }: { onClose: () => void; language?: "zh-TW" | "en" | "ja" }) {
  const t = T[(language ?? "en") as LangKey];
  const [tab, setTab] = useState<Tab>("tasks");
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [executions, setExecutions] = useState<TaskExecution[]>([]);
  const [editing, setEditing] = useState<ScheduledTask | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());

  // Execution filters
  const [execTaskFilter, setExecTaskFilter] = useState("all");
  const [execStatusFilter, setExecStatusFilter] = useState("all");

  const fetchTasks = useCallback(() => {
    fetch("/api/scheduled-tasks").then((r) => r.ok ? r.json() : []).then(setTasks).catch(() => {});
  }, []);

  const fetchAccounts = useCallback(() => {
    fetch("/api/accounts").then((r) => r.ok ? r.json() : []).then(setAccounts).catch(() => {});
  }, []);

  const fetchExecutions = useCallback(() => {
    fetch("/api/scheduled-tasks/executions/recent?limit=100").then((r) => r.ok ? r.json() : []).then(setExecutions).catch(() => {});
  }, []);

  useEffect(() => { fetchTasks(); fetchAccounts(); }, [fetchTasks, fetchAccounts]);
  useEffect(() => { if (tab === "executions") fetchExecutions(); }, [tab, fetchExecutions]);

  // Poll running executions for updates
  useEffect(() => {
    if (runningIds.size === 0) return;
    const interval = setInterval(() => {
      fetchTasks();
      if (tab === "executions") fetchExecutions();
    }, 5000);
    return () => clearInterval(interval);
  }, [runningIds.size, tab, fetchTasks, fetchExecutions]);

  const accountMap = new Map(accounts.map((a) => [a.id, a]));
  const taskMap = new Map(tasks.map((t) => [t.id, t]));

  // --- Actions ---

  const handleSaveTask = async (data: any) => {
    const isNewTask = isNew;
    const url = isNewTask ? "/api/scheduled-tasks" : `/api/scheduled-tasks/${data.id}`;
    const method = isNewTask ? "POST" : "PUT";
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        setEditing(null);
        setIsNew(false);
        fetchTasks();
        setNotice({ type: "success", text: t.taskSaved });
      } else {
        const err = await res.json().catch(() => ({}));
        setNotice({ type: "error", text: err.error || t.taskSaveFailed });
      }
    } catch {
      setNotice({ type: "error", text: t.taskSaveFailed });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/scheduled-tasks/${id}`, { method: "DELETE" });
      if (res.ok) {
        fetchTasks();
        setNotice({ type: "success", text: t.taskDeleted });
      }
    } catch {}
  };

  const handleToggle = async (id: string) => {
    try {
      const res = await fetch(`/api/scheduled-tasks/${id}/toggle`, { method: "PATCH" });
      if (res.ok) fetchTasks();
    } catch {}
  };

  const handleRunNow = async (id: string) => {
    try {
      const res = await fetch(`/api/scheduled-tasks/${id}/run`, { method: "POST" });
      if (res.ok) {
        setRunningIds((prev) => new Set(prev).add(id));
        setNotice({ type: "success", text: t.taskRunStarted });
        // Clear running state after some time
        setTimeout(() => {
          setRunningIds((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
          fetchExecutions();
        }, 10000);
      } else if (res.status === 409) {
        setNotice({ type: "error", text: t.taskAlreadyRunning });
      } else {
        setNotice({ type: "error", text: t.taskRunFailed });
      }
    } catch {
      setNotice({ type: "error", text: t.taskRunFailed });
    }
  };

  // Filtered executions
  const filteredExecs = executions.filter((e) => {
    if (execTaskFilter !== "all" && e.task_id !== execTaskFilter) return false;
    if (execStatusFilter !== "all" && e.status !== execStatusFilter) return false;
    return true;
  });

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "tasks", label: t.tabTasks, count: tasks.length },
    { key: "executions", label: t.tabExecutions },
  ];

  return (
    <div className="flex-1 flex flex-col bg-white dark:bg-gray-900 overflow-y-auto">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between sticky top-0 bg-white dark:bg-gray-900 z-10">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">{t.pageTitle}</h2>
          <div className="flex gap-1">
            {tabs.map((tab_item) => (
              <button
                key={tab_item.key}
                onClick={() => setTab(tab_item.key)}
                className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
                  tab === tab_item.key
                    ? "bg-blue-600 text-white"
                    : "text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-800"
                }`}
              >
                {tab_item.label}
                {tab_item.count !== undefined && tab_item.count > 0 && (
                  <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] ${
                    tab === tab_item.key ? "bg-blue-500 text-white" : "bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-400"
                  }`}>
                    {tab_item.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
        <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
          {t.backToChat}
        </button>
      </div>

      <div className="p-6 max-w-3xl">
        {/* Notice banner */}
        {notice && (
          <div className={`mb-4 px-3 py-2 rounded-lg text-xs flex items-center justify-between ${
            notice.type === "success"
              ? "bg-green-50 border border-green-200 text-green-700 dark:bg-green-950 dark:border-green-800 dark:text-green-400"
              : "bg-red-50 border border-red-200 text-red-700 dark:bg-red-950 dark:border-red-800 dark:text-red-400"
          }`}>
            <span>{notice.text}</span>
            <button onClick={() => setNotice(null)} className="text-gray-400 hover:text-gray-600 ml-2">x</button>
          </div>
        )}

        {/* ===== Tasks Tab ===== */}
        {tab === "tasks" && (
          <div className="space-y-4">
            {/* Toolbar */}
            <div className="flex items-center justify-end">
              <button
                onClick={() => {
                  setEditing({ id: "", created_at: "", updated_at: "", ...EMPTY_TASK });
                  setIsNew(true);
                }}
                className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium"
              >
                {t.addTask}
              </button>
            </div>

            {tasks.length === 0 && !editing && (
              <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">
                {t.noTasks}
              </p>
            )}

            {tasks.map((task) => {
              const account = accountMap.get(task.account_id);
              const isRunning = runningIds.has(task.id);

              return (
                <div key={task.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {/* Status indicator */}
                      <div className={`w-2 h-2 rounded-full shrink-0 ${task.enabled ? "bg-green-500" : "bg-gray-400"}`} />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">{task.name}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400 font-mono">
                            {cronToHuman(task.schedule)}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 dark:bg-blue-900 dark:text-blue-300">
                            {t.minScore}: {task.min_score}
                          </span>
                          {task.auto_publish ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-50 text-green-600 dark:bg-green-900 dark:text-green-300">
                              {t.autoPublish}
                            </span>
                          ) : null}
                        </div>
                        <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                          {account ? `${account.handle} (${account.platform})` : task.account_id}
                          {" · "}{task.timezone}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleRunNow(task.id)}
                        disabled={isRunning}
                        className="text-xs px-2.5 py-1 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-40 font-medium"
                      >
                        {isRunning ? t.running : t.runNow}
                      </button>
                      {/* Enable toggle */}
                      <button
                        onClick={() => handleToggle(task.id)}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${task.enabled ? "bg-green-500" : "bg-gray-300 dark:bg-gray-600"}`}
                        title={task.enabled ? t.enabled : t.disabled}
                      >
                        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${task.enabled ? "translate-x-4" : "translate-x-0.5"}`} />
                      </button>
                      <button
                        onClick={() => { setEditing({ ...task }); setIsNew(false); }}
                        className="text-xs px-2 py-1 border border-gray-200 rounded hover:bg-gray-50 text-gray-600 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800"
                      >
                        {t.edit}
                      </button>
                      <button
                        onClick={() => handleDelete(task.id)}
                        className="text-xs px-2 py-1 text-red-500 hover:bg-red-50 rounded"
                      >
                        {t.delete}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            {editing && (
              <TaskForm
                task={editing}
                isNew={isNew}
                accounts={accounts}
                onSave={handleSaveTask}
                onCancel={() => { setEditing(null); setIsNew(false); }}
                t={t}
              />
            )}
          </div>
        )}

        {/* ===== Executions Tab ===== */}
        {tab === "executions" && (
          <div className="space-y-4">
            {/* Filters */}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 dark:text-gray-400">{t.filterByTask}</span>
                <select
                  value={execTaskFilter}
                  onChange={(e) => setExecTaskFilter(e.target.value)}
                  className="text-xs px-2 py-1 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded"
                >
                  <option value="all">{t.allTasks}</option>
                  {tasks.map((tk) => (
                    <option key={tk.id} value={tk.id}>{tk.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 dark:text-gray-400">{t.filterByStatus}</span>
                <select
                  value={execStatusFilter}
                  onChange={(e) => setExecStatusFilter(e.target.value)}
                  className="text-xs px-2 py-1 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded"
                >
                  <option value="all">{t.allStatuses}</option>
                  {["running", "completed", "published", "failed", "rejected"].map((s) => (
                    <option key={s} value={s}>{t[`status${s.charAt(0).toUpperCase() + s.slice(1)}` as keyof Translations] as string}</option>
                  ))}
                </select>
              </div>
              <button onClick={fetchExecutions} className="text-xs text-blue-500 hover:text-blue-700">{t.refresh}</button>
            </div>

            {filteredExecs.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">{t.noExecutions}</p>
            ) : (
              <div className="space-y-2">
                {filteredExecs.map((exec) => (
                  <ExecutionRow
                    key={exec.id}
                    execution={exec}
                    taskName={taskMap.get(exec.task_id)?.name}
                    accountHandle={accountMap.get(exec.account_id)?.handle}
                    t={t}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
