import {
  Bot,
  User,
  Gauge,
  Zap,
  Layers,
  Terminal,
  FileText,
  Search,
  PenLine,
  Brain,
  MessageSquare,
  ChevronDown,
  ChevronRight,
  Coins,
  BookOpen,
  Clock,
  Copy,
  Check,
  LoaderCircle,
  AlertTriangle,
  X,
} from "lucide-react";
import { clsx } from "clsx";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { SessionDetail, Action, Source } from "../App";
import { formatDuration } from "../lib/format";
import { SOURCE_BADGE_CLASS, SOURCE_DISPLAY_NAMES } from "../lib/source";
import { SourceIcon } from "./SourceIcon";
import { useSettings } from "../lib/useSettings";
import { getSubagentSession } from "../lib/api";

interface Props {
  session: SessionDetail;
}

/** A selected "subagent" action, shown in the right-hand pane. Selection
 * (rather than each action managing its own inline expand state) lives at
 * the `SessionView` root so only one sub-agent transcript pane is open at a
 * time, consistently positioned to the right regardless of how deep the
 * action is nested in the main transcript. */
interface SubagentSelection {
  action: Action;
  subSessionId: string;
}

const SubagentSelectionContext = createContext<{
  selectedSubSessionId: string | null;
  select: (selection: SubagentSelection) => void;
} | null>(null);

function ActionIcon({ type }: { type: string }) {
  switch (type) {
    case "reasoning":
      return <Brain size={12} className="text-purple-400" />;
    case "say":
      return <MessageSquare size={12} className="text-blue-400" />;
    case "runCommand":
      return <Terminal size={12} className="text-green-400" />;
    case "readFiles":
      return <FileText size={12} className="text-yellow-400" />;
    case "search":
      return <Search size={12} className="text-cyan-400" />;
    case "replace":
    case "write":
    case "create":
      return <PenLine size={12} className="text-orange-400" />;
    case "knowledge":
      return <BookOpen size={12} className="text-pink-400" />;
    case "subagent":
      return <Layers size={12} className="text-indigo-400" />;
    default:
      return <Zap size={12} className="text-[var(--text-secondary)]" />;
  }
}

function describeAction(action: Action): string {
  const { actionType, input } = action;
  const i = input ?? {};
  switch (actionType) {
    case "runCommand":
      return i.command || i.cmd || "command";
    case "readFiles": {
      // IDE: files[].path ; CLI read tool: operations[].path
      if (Array.isArray(i.files))
        return i.files.map((f: any) => f.path).join(", ");
      if (Array.isArray(i.operations))
        return (
          i.operations
            .map((o: any) => o.path || o.target || "")
            .filter(Boolean)
            .join(", ") || "read"
        );
      if (i.path) return i.path;
      return "read";
    }
    case "search":
      return i.query || i.searchQuery || "search";
    case "replace":
    case "write":
    case "create":
      return i.file || i.path || actionType;
    case "getDiagnostics":
      return Array.isArray(i.paths) ? i.paths.join(", ") : "diagnostics";
    case "knowledge":
      return i.command || i.query || "knowledge";
    case "subagent":
      return i.subAgentName || "sub-agent";
    default:
      return actionType;
  }
}

function renderOutput(action: Action): React.ReactNode {
  const { output } = action;
  if (output == null) return null;
  // CLI shell output is usually an object with exit_status/stdout/stderr
  if (
    typeof output === "object" &&
    !Array.isArray(output) &&
    (output.stdout !== undefined || output.stderr !== undefined)
  ) {
    return (
      <div className="space-y-1">
        {output.exit_status && (
          <div className="text-[10px] text-[var(--text-secondary)]">
            {output.exit_status}
          </div>
        )}
        {output.stdout && (
          <pre className="text-[var(--text-primary)] whitespace-pre-wrap break-words">
            {String(output.stdout)}
          </pre>
        )}
        {output.stderr && (
          <pre className="text-[var(--text-secondary)] whitespace-pre-wrap break-words border-t border-[var(--border)] pt-1">
            {String(output.stderr)}
          </pre>
        )}
      </div>
    );
  }
  if (typeof output === "string") {
    return (
      <pre className="text-[var(--text-primary)] whitespace-pre-wrap break-words">
        {output}
      </pre>
    );
  }
  return (
    <pre className="text-[var(--text-primary)]">
      {JSON.stringify(output, null, 2)}
    </pre>
  );
}

function ActionBlock({
  action,
  sessionId,
}: {
  action: Action;
  /** Root session id — needed only for `actionType: "subagent"`, to fetch
   * its transcript (sub-agent traces live under the *root* session's
   * directory, not any intermediate sub-agent's). */
  sessionId?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const isThinking = action.actionType === "reasoning";
  const isSay = action.actionType === "say";
  const isSubagent = action.actionType === "subagent";
  const message =
    typeof action.output === "object" && action.output !== null
      ? action.output.message
      : undefined;

  if (isSay && message) {
    return (
      <div className="text-sm text-[var(--text-primary)] whitespace-pre-wrap">
        {message}
      </div>
    );
  }

  if (isThinking) {
    return (
      <div className="border-l-2 border-purple-500/40 pl-3 my-1">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300"
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <Brain size={12} /> Thinking
        </button>
        {expanded && (
          <div className="mt-1 text-xs text-[var(--text-secondary)] whitespace-pre-wrap">
            {message}
          </div>
        )}
      </div>
    );
  }

  if (isSubagent && action.subSessionId && sessionId) {
    return <SubAgentActionRow action={action} subSessionId={action.subSessionId} />;
  }

  return (
    <div className="my-1 min-w-0 flex flex-col gap-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full min-w-0 flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] font-mono"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <ActionIcon type={action.actionType} />
        <span className="truncate flex-1 min-w-0 text-left">{describeAction(action)}</span>
        {action.rawToolName && action.rawToolName !== action.actionType && (
          <span className="text-[10px] text-[var(--text-secondary)] opacity-70 shrink-0">
            [{action.rawToolName}]
          </span>
        )}
        {action.actionState && action.actionState !== "Success" && (
          <span
            className={clsx(
              "ml-1 shrink-0",
              action.actionState === "Error"
                ? "text-red-400"
                : "text-yellow-500",
            )}
          >
            ({action.actionState})
          </span>
        )}
      </button>
      {expanded && (
        <div className="ml-5 min-w-0 text-xs bg-[var(--bg-tertiary)] rounded p-2 overflow-x-auto">
          {action.input && (
            <pre className="text-[var(--text-secondary)] whitespace-pre-wrap break-words">
              {JSON.stringify(action.input, null, 2)}
            </pre>
          )}
          {action.output && (
            <div className="mt-1 border-t border-[var(--border)] pt-1">
              {renderOutput(action)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** A dispatched sub-agent task (e.g. the spec agent's `spec-task-execution`
 * sub-agent). Selecting it opens/updates the right-hand pane (see
 * `SubAgentPane`) with that sub-agent's own transcript, fetched from its
 * separate on-disk file — rather than expanding inline, so the main
 * transcript's flow isn't interrupted by a potentially long nested thread. */
function SubAgentActionRow({
  action,
  subSessionId,
}: {
  action: Action;
  subSessionId: string;
}) {
  const ctx = useContext(SubagentSelectionContext);
  const isSelected = ctx?.selectedSubSessionId === subSessionId;
  const isError = action.actionState === "Error";

  return (
    <button
      onClick={() => ctx?.select({ action, subSessionId })}
      className={clsx(
        "my-1 flex items-center gap-1.5 text-xs font-mono rounded px-1.5 py-1 -mx-1.5 transition-colors w-full min-w-0 text-left",
        isSelected
          ? "bg-indigo-500/15 text-indigo-300"
          : "text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/5",
      )}
    >
      <Layers size={12} className="shrink-0" />
      <span className="truncate flex-1 min-w-0">{describeAction(action)}</span>
      {isError && (
        <span className="ml-1 flex items-center gap-0.5 text-red-400 shrink-0">
          <AlertTriangle size={10} /> Error
        </span>
      )}
      {!action.actionState || action.actionState === "Pending" ? (
        <span className="ml-1 text-yellow-500 shrink-0">(Pending)</span>
      ) : null}
      <ChevronRight size={12} className="ml-auto shrink-0 opacity-60" />
    </button>
  );
}

/** Right-hand pane showing the currently-selected sub-agent's own
 * transcript, fetched on demand via `get_subagent_session` — it's a fully
 * separate on-disk file (`sub-executions/{subSessionId}.jsonl`), not part
 * of the parent's own message stream, so it isn't available until fetched. */
function SubAgentPane({
  sessionId,
  selection,
  onClose,
}: {
  sessionId: string;
  selection: SubagentSelection;
  onClose: () => void;
}) {
  const [trace, setTrace] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { action, subSessionId } = selection;

  useEffect(() => {
    setTrace(null);
    setLoading(true);
    setError(null);
    getSubagentSession(sessionId, subSessionId)
      .then(setTrace)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [sessionId, subSessionId]);

  const prompt: string | undefined = action.input?.prompt;
  const isError = action.actionState === "Error";
  const errorMessage: string | undefined =
    typeof action.output === "object" ? action.output?.errorMessage : undefined;

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 border-b border-[var(--border)] p-4">
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="flex-1 min-w-0 flex items-center gap-1.5 text-sm font-medium text-indigo-300">
            <Layers size={14} className="shrink-0" />
            <span className="truncate min-w-0">{describeAction(action)}</span>
          </div>
          <button
            onClick={onClose}
            aria-label="Close sub-agent pane"
            className="shrink-0 p-1 rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
          >
            <X size={14} />
          </button>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {isError ? (
            <span className="flex items-center gap-1 text-red-400">
              <AlertTriangle size={11} /> Error
            </span>
          ) : action.actionState === "Pending" ? (
            <span className="text-yellow-500">Pending</span>
          ) : (
            <span className="text-[var(--text-secondary)]">Sub-agent transcript</span>
          )}
        </div>
        {prompt && (
          <div className="mt-2 text-xs bg-[var(--bg-tertiary)] rounded p-2 text-[var(--text-secondary)] whitespace-pre-wrap break-words max-h-24 overflow-y-auto">
            {prompt}
          </div>
        )}
        {errorMessage && (
          <div className="mt-2 text-xs text-red-400 whitespace-pre-wrap break-words">
            {errorMessage}
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {loading && (
          <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)] py-1">
            <LoaderCircle size={12} className="animate-spin" />
            Loading sub-agent transcript...
          </div>
        )}
        {error && (
          <div className="text-xs text-red-400">
            Failed to load sub-agent transcript: {error}
          </div>
        )}
        {trace && trace.history.length > 0 && (
          <MessageList history={trace.history} source={trace.source} sessionId={sessionId} />
        )}
        {trace && trace.history.length === 0 && (
          <div className="text-xs text-[var(--text-secondary)] italic">
            (no transcript recorded)
          </div>
        )}
      </div>
    </div>
  );
}

/** Renders a session's (or a sub-agent's own) message thread. Shared by the
 * top-level `SessionView` and `SubAgentAction`'s nested transcript, so
 * sub-agent transcripts render with identical formatting instead of a
 * separate, drifting copy. */
function MessageList({
  history,
  source,
  sessionId,
}: {
  history: SessionDetail["history"];
  source: Source;
  sessionId: string;
}) {
  return (
    <div className="space-y-4">
      {history.map((msg, i) => (
        <div
          key={i}
          className={clsx(
            "rounded-lg p-4 text-sm leading-relaxed border",
            msg.role === "user"
              ? "bg-[var(--bg-tertiary)] border-[var(--border)]"
              : source === "cli"
                ? "bg-emerald-500/5 border-emerald-500/20"
                : source === "unified"
                  ? "bg-violet-500/5 border-violet-500/20"
                  : "bg-[var(--bg-secondary)] border-[var(--border)]",
          )}
        >
          <div className="flex items-center gap-2 mb-2 text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">
            {msg.role === "user" ? (
              <User size={12} className="text-blue-400" />
            ) : (
              <Bot
                size={12}
                className={
                  source === "cli"
                    ? "text-emerald-400"
                    : source === "unified"
                      ? "text-violet-400"
                      : "text-[var(--accent)]"
                }
              />
            )}
            {msg.role}
            {msg.cost ? (
              <span className="ml-auto font-normal normal-case tracking-normal text-[var(--text-secondary)]">
                {msg.cost.toFixed(2)} credits
              </span>
            ) : null}
          </div>

          {msg.blocks && msg.blocks.length > 0 ? (
            <div className="flex flex-col gap-1">
              {msg.blocks.map((block, j) =>
                block.type === "text" ? (
                  <div
                    key={j}
                    className="whitespace-pre-wrap break-words text-[var(--text-primary)]"
                  >
                    {block.text}
                  </div>
                ) : (
                  <ActionBlock key={j} action={block} sessionId={sessionId} />
                ),
              )}
            </div>
          ) : (
            <>
              {msg.content && (
                <div className="whitespace-pre-wrap break-words text-[var(--text-primary)]">
                  {msg.content}
                </div>
              )}

              {msg.actions && msg.actions.length > 0 && (
                <div className="mt-2 flex flex-col gap-1">
                  {msg.actions.map((action, j) => (
                    <ActionBlock key={j} action={action} sessionId={sessionId} />
                  ))}
                </div>
              )}
            </>
          )}

          {!msg.content &&
            (!msg.actions || msg.actions.length === 0) &&
            (!msg.blocks || msg.blocks.length === 0) && (
              <span className="italic text-[var(--text-secondary)]">
                (empty)
              </span>
            )}
        </div>
      ))}
    </div>
  );
}

/** Builds the shell command to resume this session from its workspace. */
function resumeCommand(session: SessionDetail, cliPath: string): string {
  const flags = session.source === "unified" ? "--v3 " : "";
  const bin = cliPath.trim() || "kiro-cli";
  return `cd ${session.workspacePath} && ${bin} ${flags}--resume-id ${session.sessionId}`;
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard API unavailable — fall back to a hidden textarea + execCommand.
    const el = document.createElement("textarea");
    el.value = text;
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    document.execCommand("copy");
    document.body.removeChild(el);
  }
}

function SessionIdCopy({ session }: { session: SessionDetail }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { kiroCliPath } = useSettings();

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const copy = async (text: string) => {
    await copyToClipboard(text);
    setOpen(false);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div ref={rootRef} className="relative shrink-0 ml-auto">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Copy session ID or resume command"
        className="flex items-center gap-1 text-[11px] font-mono text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
      >
        {copied ? (
          <>
            <Check size={11} className="text-green-400" /> Copied
          </>
        ) : (
          <>
            {session.sessionId}
            <ChevronDown size={11} />
          </>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 w-56 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] shadow-lg py-1 text-xs">
          <button
            onClick={() => copy(session.sessionId)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
          >
            <Copy size={12} /> Copy session ID
          </button>
          <button
            onClick={() => copy(resumeCommand(session, kiroCliPath))}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
          >
            <Terminal size={12} /> Copy resume command
          </button>
        </div>
      )}
    </div>
  );
}

/** Minimum width (px) either side of the drag handle is allowed to shrink
 * to — keeps both the main transcript and the sub-agent pane usable at the
 * extremes of a drag. */
const MIN_PANE_WIDTH = 280;
const MIN_MAIN_WIDTH = 360;

function clampPaneWidth(width: number, containerWidth: number): number {
  const max = Math.max(MIN_PANE_WIDTH, containerWidth - MIN_MAIN_WIDTH);
  return Math.min(Math.max(width, MIN_PANE_WIDTH), max);
}

/** Drag handle between the main transcript and the sub-agent pane. Uses
 * Pointer Events (rather than plain mouse events) so dragging keeps working
 * correctly even if the pointer briefly leaves the handle's thin hit area
 * mid-drag. */
function ResizeHandle({ onResize }: { onResize: (deltaX: number) => void }) {
  const draggingRef = useRef(false);
  const lastXRef = useRef(0);
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      const deltaX = e.clientX - lastXRef.current;
      lastXRef.current = e.clientX;
      onResizeRef.current(deltaX);
    };
    const stopDragging = () => {
      draggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stopDragging);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stopDragging);
    };
  }, []);

  return (
    <div
      onPointerDown={(e) => {
        draggingRef.current = true;
        lastXRef.current = e.clientX;
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      }}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sub-agent pane"
      className="w-1 shrink-0 cursor-col-resize bg-[var(--border)] hover:bg-[var(--accent)]/50 active:bg-[var(--accent)]/70 transition-colors"
    />
  );
}

export function SessionView({ session }: Props) {
  const isCli = session.source === "cli";
  const { showNonUnified } = useSettings();
  const [selection, setSelection] = useState<SubagentSelection | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [paneWidth, setPaneWidth] = useState(420);
  // Only set once per session view, the first time the pane opens — after
  // that, a manual resize should stick across selecting other sub-agents in
  // the same session rather than snapping back to 50% every time.
  const hasSizedPane = useRef(false);

  useEffect(() => {
    if (selection && !hasSizedPane.current) {
      hasSizedPane.current = true;
      const total = containerRef.current?.getBoundingClientRect().width;
      if (total) {
        setPaneWidth(clampPaneWidth(Math.round(total * 0.5), total));
      }
    }
  }, [selection]);

  const handleResize = (deltaX: number) => {
    const total = containerRef.current?.getBoundingClientRect().width;
    if (!total) return;
    setPaneWidth((w) => clampPaneWidth(w - deltaX, total));
  };

  return (
    <div ref={containerRef} className="h-full flex">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-6">
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-2">
              {/* Unified sessions are the default/only kind once non-unified
                  sessions are hidden, so the source badge is redundant there. */}
              {(showNonUnified || session.source !== "unified") && (
                <span
                  className={clsx(
                    "inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide border",
                    SOURCE_BADGE_CLASS[session.source],
                  )}
                >
                  <SourceIcon source={session.source} size={10} />{" "}
                  {SOURCE_DISPLAY_NAMES[session.source]}
                </span>
              )}
              {/* Legacy CLI (v2) keeps its version tag. The v3 tag is retired:
                  those sessions now surface as the "Unified" source instead. */}
              {isCli && session.cliVersion != null && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
                  v{session.cliVersion}
                </span>
              )}
              <h2 className="text-lg font-medium truncate">
                {session.title || "Untitled"}
              </h2>
            </div>
            <div className="flex items-center gap-3 text-xs text-[var(--text-secondary)] mb-2 font-mono">
              <span className="truncate">{session.workspacePath}</span>
              <SessionIdCopy session={session} />
            </div>
            <div className="flex flex-wrap gap-3 text-xs text-[var(--text-secondary)]">
              <span className="flex items-center gap-1 px-2 py-1 rounded-full bg-[var(--bg-tertiary)]">
                <Bot size={12} /> {session.model}
              </span>
              <span className="flex items-center gap-1 px-2 py-1 rounded-full bg-[var(--bg-tertiary)]">
                <Zap size={12} />{" "}
                {isCli ? `agent:${session.autonomyMode}` : session.autonomyMode}
              </span>
              <span className="flex items-center gap-1 px-2 py-1 rounded-full bg-[var(--bg-tertiary)]">
                <Layers size={12} /> {session.sessionType}
              </span>
              <span className="flex items-center gap-1 px-2 py-1 rounded-full bg-[var(--bg-tertiary)]">
                <Gauge size={12} /> {session.contextUsage?.toFixed(1)}% context
              </span>
              <span className="px-2 py-1 rounded-full bg-[var(--bg-tertiary)]">
                {session.messageCount} messages
              </span>
              {session.durationMs != null && session.durationMs > 0 && (
                <span className="flex items-center gap-1 px-2 py-1 rounded-full bg-[var(--bg-tertiary)]">
                  <Clock size={12} /> {formatDuration(session.durationMs)}
                </span>
              )}
              {session.totalCost > 0 && (
                <span className="flex items-center gap-1 px-2 py-1 rounded-full bg-[var(--bg-tertiary)]">
                  <Coins size={12} /> {session.totalCost.toFixed(2)} credits
                </span>
              )}
            </div>
          </div>

          <SubagentSelectionContext.Provider
            value={{
              selectedSubSessionId: selection?.subSessionId ?? null,
              select: setSelection,
            }}
          >
            <MessageList
              history={session.history}
              source={session.source}
              sessionId={session.sessionId}
            />
          </SubagentSelectionContext.Provider>
        </div>
      </div>

      {selection && (
        <>
          <ResizeHandle onResize={handleResize} />
          <div
            className="shrink-0 bg-[var(--bg-secondary)]"
            style={{ width: paneWidth }}
          >
            <SubAgentPane
              sessionId={session.sessionId}
              selection={selection}
              onClose={() => setSelection(null)}
            />
          </div>
        </>
      )}
    </div>
  );
}
