import type { WorkflowNode, WorkflowRun, Workspace } from "../App";

/** Every node of the run's tree, depth-first in display order. */
export function flattenNodes(nodes: WorkflowNode[]): WorkflowNode[] {
  return nodes.flatMap((n) => [n, ...flattenNodes(n.children)]);
}

/** Leaf nodes (steps, and groups with no children yet) — what "step N of M"
 * counts. */
export function leafNodes(nodes: WorkflowNode[]): WorkflowNode[] {
  return nodes.flatMap((n) => (n.children.length ? leafNodes(n.children) : [n]));
}

export function runSessionIds(run: WorkflowRun): Set<string> {
  const ids = new Set<string>();
  for (const n of flattenNodes(run.steps)) if (n.sessionId) ids.add(n.sessionId);
  return ids;
}

export function isCompleted(status: string | null): boolean {
  return status === "completed" || status === "succeeded" || status === "success";
}

/** Kiro's status as display text ("in_progress" -> "In progress"). */
export function statusLabel(status: string | null): string {
  if (!status) return "";
  const s = status.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function nodeDuration(n: WorkflowNode): number | null {
  return n.startedAt != null && n.endedAt != null && n.endedAt > n.startedAt
    ? n.endedAt - n.startedAt
    : null;
}

/** The workflow run (and its backing workspace id) a session is a step of. */
export function findRunForSession(
  workspaces: Workspace[],
  sessionId: string,
): { run: WorkflowRun; workspaceId: string } | null {
  for (const ws of workspaces) {
    for (const run of ws.workflows ?? []) {
      if (runSessionIds(run).has(sessionId)) return { run, workspaceId: ws.id };
    }
  }
  return null;
}
