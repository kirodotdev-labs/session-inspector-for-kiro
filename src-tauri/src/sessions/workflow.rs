use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use super::cli::{parse_iso_ms, CliSessionMeta};
use super::paths::Paths;
use super::types::{WorkflowNode, WorkflowRun};

// ---------------------------------------------------------------------------
// Kiro workflow runs. Each step of a run is an ordinary Unified (v3) session
// whose session.json carries `_meta.kiro.workflow`; the run itself is
// described by `{v3SessionsDir}/{hash}/workflows/{workflowId}/`:
//   - workflow-state.json: run status/label/parent and a `root` node tree
//     (per-node status, agent, model, sessionId, start/end, credits)
//   - workflow-definition.json: the planned steps (used when the state tree
//     is missing)
//   - sessions.json: nodeId -> sessionId mapping
// When no state file can be read, runs are rebuilt from the step sessions'
// metadata alone.
// ---------------------------------------------------------------------------

fn str_field(v: &Value, key: &str) -> Option<String> {
    v.get(key)
        .and_then(|x| x.as_str())
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn ts_field(v: &Value, key: &str) -> Option<i64> {
    str_field(v, key).map(|s| parse_iso_ms(&s)).filter(|&t| t > 0)
}

fn read_json(path: &Path) -> Option<Value> {
    serde_json::from_str(&fs::read_to_string(path).ok()?).ok()
}

/// Every `workflows/*/` directory under the v3 session root that holds any
/// of the run files (`workflow-state.json`, `workflow-definition.json`,
/// `sessions.json`).
fn find_workflow_dirs(v3_root: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let Ok(ws_dirs) = fs::read_dir(v3_root) else {
        return out;
    };
    for wd in ws_dirs.flatten() {
        if wd.file_name() == "cli" {
            continue; // legacy v2 sessions
        }
        let Ok(entries) = fs::read_dir(wd.path().join("workflows")) else {
            continue;
        };
        for e in entries.flatten() {
            let p = e.path();
            if ["workflow-state.json", "workflow-definition.json", "sessions.json"]
                .iter()
                .any(|f| p.join(f).is_file())
            {
                out.push(p);
            }
        }
    }
    out
}

fn parse_node(v: &Value, session_by_node: &HashMap<String, String>) -> WorkflowNode {
    let node_id = str_field(v, "nodeId")
        .or_else(|| str_field(v, "id"))
        .unwrap_or_default();
    let credits = v
        .get("credits")
        .and_then(|c| c.as_array())
        .map(|a| a.iter().filter_map(|c| c.get("usage").and_then(|u| u.as_f64())).sum())
        .unwrap_or(0.0);
    let children = v
        .get("children")
        .or_else(|| v.get("steps"))
        .and_then(|c| c.as_array())
        .map(|a| a.iter().map(|c| parse_node(c, session_by_node)).collect())
        .unwrap_or_default();
    WorkflowNode {
        node_type: str_field(v, "type").unwrap_or_else(|| "step".to_string()),
        status: str_field(v, "status"),
        agent_name: str_field(v, "agentName").or_else(|| str_field(v, "agent")),
        model_id: str_field(v, "modelId"),
        effort_level: str_field(v, "effortLevel"),
        session_id: str_field(v, "sessionId").or_else(|| session_by_node.get(&node_id).cloned()),
        started_at: ts_field(v, "startedAt"),
        ended_at: ts_field(v, "endedAt"),
        credits,
        children,
        node_id,
    }
}

/// Parses one `workflows/{id}/` directory. Returns the run plus the
/// definition's own name, which is only a fallback (`runLabel` and the step
/// sessions' `workflowName` are the user-facing names). Each file is
/// optional: the node tree comes from the state file, else the definition,
/// else the `sessions.json` node -> session mapping.
fn load_workflow_dir(dir: &Path) -> Option<(WorkflowRun, Option<String>)> {
    let state = read_json(&dir.join("workflow-state.json"));
    let definition = read_json(&dir.join("workflow-definition.json"));
    let sessions_file = read_json(&dir.join("sessions.json"));
    if state.is_none() && definition.is_none() && sessions_file.is_none() {
        return None;
    }
    let state = state.unwrap_or(Value::Null);

    // (nodeId, sessionId) in file order; the last entry for a node wins in
    // the lookup map.
    let session_entries: Vec<(String, String)> = sessions_file
        .as_ref()
        .and_then(|v| v.get("sessions").and_then(|s| s.as_array()))
        .map(|a| {
            a.iter()
                .filter_map(|s| Some((str_field(s, "nodeId")?, str_field(s, "sessionId")?)))
                .collect()
        })
        .unwrap_or_default();
    let session_by_node: HashMap<String, String> = session_entries.iter().cloned().collect();

    let tree = state
        .get("root")
        .and_then(|r| r.get("children"))
        .and_then(|s| s.as_array())
        .filter(|a| !a.is_empty())
        .or_else(|| {
            definition
                .as_ref()
                .and_then(|d| d.get("steps"))
                .and_then(|s| s.as_array())
                .filter(|a| !a.is_empty())
        });
    let steps: Vec<WorkflowNode> = match tree {
        Some(a) => a.iter().map(|n| parse_node(n, &session_by_node)).collect(),
        None => {
            let mut seen = HashSet::new();
            session_entries
                .iter()
                .filter(|(node, _)| seen.insert(node.as_str()))
                .map(|(node, _)| WorkflowNode {
                    node_id: node.clone(),
                    node_type: "step".to_string(),
                    session_id: session_by_node.get(node).cloned(),
                    ..Default::default()
                })
                .collect()
        }
    };

    let id = str_field(&state, "workflowId")
        .or_else(|| sessions_file.as_ref().and_then(|v| str_field(v, "workflowId")))
        .or_else(|| dir.file_name().map(|n| n.to_string_lossy().to_string()))?;
    let fallback_name = str_field(&state, "workflowName")
        .or_else(|| definition.as_ref().and_then(|d| str_field(d, "name")));

    let run = WorkflowRun {
        name: str_field(&state, "runLabel").unwrap_or_default(),
        status: str_field(&state, "status"),
        workspace_path: str_field(&state, "workspacePath").unwrap_or_default(),
        parent_session_id: str_field(&state, "parentSessionId")
            .or_else(|| str_field(&state, "rootConversationId")),
        created_at: ts_field(&state, "createdAt").unwrap_or(0),
        last_activity_at: 0,
        total_credits: 0.0,
        steps,
        id,
    };
    Some((run, fallback_name))
}

fn visit_nodes<'a>(nodes: &'a [WorkflowNode], f: &mut impl FnMut(&'a WorkflowNode)) {
    for n in nodes {
        f(n);
        visit_nodes(&n.children, f);
    }
}

fn visit_nodes_mut(nodes: &mut [WorkflowNode], f: &mut impl FnMut(&mut WorkflowNode)) {
    for n in nodes {
        f(n);
        visit_nodes_mut(&mut n.children, f);
    }
}

/// Ids of every step session referenced anywhere in the run's node tree.
pub fn run_session_ids(run: &WorkflowRun) -> Vec<&str> {
    let mut ids = Vec::new();
    visit_nodes(&run.steps, &mut |n| {
        if let Some(id) = n.session_id.as_deref() {
            ids.push(id);
        }
    });
    ids
}

/// Fills in what the run files don't carry from its sessions, appends step
/// sessions the tree doesn't reference (so no step is ever unreachable),
/// and computes the aggregate fields. `steps` are the sessions tagged with
/// this run's `_meta.kiro.workflow`; `all_by_id` is every v3 session, so
/// nodes linked to a session without that tag are still filled in.
fn reconcile(
    run: &mut WorkflowRun,
    steps: &[&CliSessionMeta],
    all_by_id: &HashMap<&str, &CliSessionMeta>,
    fallback_name: Option<String>,
) {
    if run.name.is_empty() {
        run.name = steps
            .iter()
            .filter_map(|m| m.workflow.as_ref())
            .map(|w| w.workflow_name.clone())
            .find(|n| !n.is_empty())
            .or(fallback_name)
            .unwrap_or_else(|| run.id.clone());
    }
    if run.parent_session_id.is_none() {
        run.parent_session_id = steps
            .iter()
            .find_map(|m| m.workflow.as_ref().and_then(|w| w.owner_session_id.clone()));
    }
    if run.workspace_path.is_empty() {
        if let Some(m) = steps.iter().find(|m| !m.cwd.is_empty()) {
            run.workspace_path = m.cwd.clone();
        }
    }

    let referenced: HashSet<String> = run_session_ids(run).into_iter().map(str::to_string).collect();
    let mut extra: Vec<&CliSessionMeta> = steps
        .iter()
        .copied()
        .filter(|m| !referenced.contains(&m.session_id))
        .collect();
    extra.sort_by_key(|m| m.created_at);
    for m in extra {
        run.steps.push(WorkflowNode {
            node_id: m.workflow.as_ref().map(|w| w.node_id.clone()).unwrap_or_default(),
            node_type: "step".to_string(),
            session_id: Some(m.session_id.clone()),
            started_at: Some(m.created_at).filter(|&t| t > 0),
            ..Default::default()
        });
    }

    let mut last = run.created_at;
    let mut total = 0.0;
    visit_nodes_mut(&mut run.steps, &mut |n| {
        if let Some(m) = n.session_id.as_deref().and_then(|id| all_by_id.get(id)) {
            if n.credits == 0.0 {
                n.credits = m.total_cost;
            }
            if n.model_id.is_none() && !m.model.is_empty() {
                n.model_id = Some(m.model.clone());
            }
            if n.agent_name.is_none() && !m.agent_name.is_empty() {
                n.agent_name = Some(m.agent_name.clone());
            }
            last = last.max(m.updated_at);
        }
        last = last.max(n.started_at.unwrap_or(0)).max(n.ended_at.unwrap_or(0));
        total += n.credits;
    });
    run.last_activity_at = last;
    run.total_credits = total;
}

/// All workflow runs on disk, reconciled with the given CLI-family session
/// metadata (only v3 sessions with `_meta.kiro.workflow` are used).
pub fn load_workflow_runs(paths: &Paths, sessions: &[CliSessionMeta]) -> Vec<WorkflowRun> {
    let mut runs: HashMap<String, (WorkflowRun, Option<String>)> = HashMap::new();
    for dir in find_workflow_dirs(&paths.cli_v3_sessions_dir) {
        if let Some((run, fallback)) = load_workflow_dir(&dir) {
            runs.entry(run.id.clone()).or_insert((run, fallback));
        }
    }

    let mut steps_by_run: HashMap<&str, Vec<&CliSessionMeta>> = HashMap::new();
    for s in sessions {
        if let Some(w) = &s.workflow {
            steps_by_run.entry(w.workflow_id.as_str()).or_default().push(s);
        }
    }
    for id in steps_by_run.keys() {
        runs.entry(id.to_string()).or_insert_with(|| {
            (
                WorkflowRun {
                    id: id.to_string(),
                    name: String::new(),
                    status: None,
                    workspace_path: String::new(),
                    parent_session_id: None,
                    created_at: 0,
                    last_activity_at: 0,
                    total_credits: 0.0,
                    steps: Vec::new(),
                },
                None,
            )
        });
    }

    let all_by_id: HashMap<&str, &CliSessionMeta> = sessions
        .iter()
        .filter(|s| s.version == 3)
        .map(|s| (s.session_id.as_str(), s))
        .collect();
    runs.into_values()
        .map(|(mut run, fallback)| {
            let steps = steps_by_run.get(run.id.as_str()).cloned().unwrap_or_default();
            reconcile(&mut run, &steps, &all_by_id, fallback);
            run
        })
        .collect()
}

/// The workspace path a run is listed under: the cwd of its first step (or
/// parent) session that is known, else the run's own recorded path.
pub fn run_workspace_path(run: &WorkflowRun, cwd_by_session: &HashMap<&str, &str>) -> String {
    let cwd = run_session_ids(run)
        .into_iter()
        .chain(run.parent_session_id.as_deref())
        .find_map(|id| cwd_by_session.get(id).copied())
        .unwrap_or(run.workspace_path.as_str());
    if cwd.is_empty() { "(unknown)" } else { cwd }.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sessions::cli::parse_workflow_step_ref;
    use serde_json::json;
    use std::sync::atomic::{AtomicU64, Ordering};

    static COUNTER: AtomicU64 = AtomicU64::new(0);
    const WF: &str = "wf_test1";

    fn temp_paths() -> Paths {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let root = std::env::temp_dir().join(format!("kiro-wf-test-{}-{}", std::process::id(), n));
        Paths {
            global_storage: root.join("gs"),
            sessions_dir: root.join("gs/ws"),
            cli_sessions_dir: root.join("v3/cli"),
            cli_v3_sessions_dir: root.join("v3"),
        }
    }

    fn wf_dir(paths: &Paths) -> PathBuf {
        let d = paths.cli_v3_sessions_dir.join("abc123/workflows").join(WF);
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn step_meta(id: &str, node: &str, cost: f64, created: i64, updated: i64) -> CliSessionMeta {
        let data = json!({
            "id": id,
            "_meta": {"kiro": {
                "workflow": {"workflowId": WF, "workflowName": "my-run", "nodeId": node, "type": "step"},
                "serverSession": {"role": "workflow-step", "ownerSessionId": "sess_parent"}
            }}
        });
        CliSessionMeta {
            session_id: id.to_string(),
            title: format!("my-run · {node}"),
            cwd: "/tmp/proj".to_string(),
            created_at: created,
            updated_at: updated,
            model: "model-x".to_string(),
            agent_name: "wf-coder".to_string(),
            context_usage: 0.0,
            total_cost: cost,
            turn_count: 1,
            version: 3,
            v3_dir: None,
            workflow: parse_workflow_step_ref(&data),
        }
    }

    fn write_state(paths: &Paths) {
        let state = json!({
            "workflowId": WF,
            "workflowName": "workflow-from-prompt",
            "runLabel": "my-run",
            "status": "running",
            "createdAt": "2026-01-01T10:00:00.000Z",
            "parentSessionId": "sess_parent",
            "workspacePath": "/tmp/proj",
            "root": {"nodeId": WF, "type": "sequence", "status": "running", "children": [
                {"nodeId": "a", "type": "step", "status": "completed", "agentName": "wf-coder",
                 "modelId": "model-x", "sessionId": "sess_a",
                 "startedAt": "2026-01-01T10:00:00.000Z", "endedAt": "2026-01-01T10:01:30.000Z",
                 "credits": [{"usage": 1.5}, {"usage": 0.5}]},
                {"nodeId": "b", "type": "step", "status": "running", "agentName": "wf-coder",
                 "startedAt": "2026-01-01T10:01:30.000Z"},
                {"nodeId": "loop", "type": "repeat", "status": "pending"},
                {"nodeId": "c", "type": "step", "status": "pending", "agentName": "wf-coder"}
            ]}
        });
        let d = wf_dir(paths);
        fs::write(d.join("workflow-state.json"), state.to_string()).unwrap();
        let sessions = json!({"workflowId": WF, "sessions": [
            {"nodeId": "a", "sessionId": "sess_a"}, {"nodeId": "b", "sessionId": "sess_b"}
        ]});
        fs::write(d.join("sessions.json"), sessions.to_string()).unwrap();
    }

    #[test]
    fn parses_step_ref_from_session_meta() {
        let r = step_meta("sess_a", "a", 0.0, 0, 0).workflow.unwrap();
        assert_eq!(r.workflow_id, WF);
        assert_eq!(r.workflow_name, "my-run");
        assert_eq!(r.node_id, "a");
        assert_eq!(r.owner_session_id.as_deref(), Some("sess_parent"));
        assert!(parse_workflow_step_ref(&json!({"id": "x"})).is_none());
    }

    #[test]
    fn builds_run_from_state_file() {
        let paths = temp_paths();
        write_state(&paths);
        let metas = vec![
            step_meta("sess_a", "a", 9.0, 1, 2),
            step_meta("sess_b", "b", 3.0, 3, 1_900_000_000_000),
        ];
        let runs = load_workflow_runs(&paths, &metas);
        assert_eq!(runs.len(), 1);
        let run = &runs[0];
        assert_eq!(run.name, "my-run");
        assert_eq!(run.status.as_deref(), Some("running"));
        assert_eq!(run.parent_session_id.as_deref(), Some("sess_parent"));
        assert_eq!(run.steps.len(), 4);

        let a = &run.steps[0];
        assert_eq!(a.status.as_deref(), Some("completed"));
        assert_eq!(a.ended_at.unwrap() - a.started_at.unwrap(), 90_000);
        assert_eq!(a.credits, 2.0, "state credits win over session cost");

        let b = &run.steps[1];
        assert_eq!(b.session_id.as_deref(), Some("sess_b"), "filled from sessions.json");
        assert_eq!(b.credits, 3.0, "falls back to session cost");
        assert_eq!(b.model_id.as_deref(), Some("model-x"));

        assert_eq!(run.steps[2].node_type, "repeat");
        assert!(run.steps[3].session_id.is_none());
        assert_eq!(run.total_credits, 5.0);
        assert_eq!(run.last_activity_at, 1_900_000_000_000);
    }

    #[test]
    fn appends_step_sessions_missing_from_tree() {
        let paths = temp_paths();
        write_state(&paths);
        let metas = vec![step_meta("sess_a", "a", 0.0, 1, 1), step_meta("sess_z", "z", 0.0, 5, 5)];
        let run = load_workflow_runs(&paths, &metas).remove(0);
        let last = run.steps.last().unwrap();
        assert_eq!(last.node_id, "z");
        assert_eq!(last.session_id.as_deref(), Some("sess_z"));
    }

    #[test]
    fn falls_back_to_session_meta_without_state_file() {
        let paths = temp_paths();
        let metas = vec![step_meta("sess_b", "b", 1.0, 20, 30), step_meta("sess_a", "a", 2.0, 10, 15)];
        let runs = load_workflow_runs(&paths, &metas);
        assert_eq!(runs.len(), 1);
        let run = &runs[0];
        assert_eq!(run.name, "my-run");
        assert!(run.status.is_none());
        assert_eq!(run.parent_session_id.as_deref(), Some("sess_parent"));
        assert_eq!(run.workspace_path, "/tmp/proj");
        let ids: Vec<&str> = run.steps.iter().map(|n| n.node_id.as_str()).collect();
        assert_eq!(ids, ["a", "b"], "ordered by creation");
        assert_eq!(run.total_credits, 3.0);
    }

    #[test]
    fn corrupt_state_file_uses_definition_or_sessions() {
        let paths = temp_paths();
        let d = wf_dir(&paths);
        fs::write(d.join("workflow-state.json"), "{not json").unwrap();
        let def = json!({"name": "def-name", "steps": [
            {"type": "step", "id": "a", "agent": "wf-coder"},
            {"type": "repeat", "id": "loop", "steps": [{"type": "step", "id": "inner"}]}
        ]});
        fs::write(d.join("workflow-definition.json"), def.to_string()).unwrap();
        let runs = load_workflow_runs(&paths, &[]);
        let run = &runs[0];
        assert_eq!(run.id, WF);
        assert_eq!(run.name, "def-name");
        assert_eq!(run.steps[0].agent_name.as_deref(), Some("wf-coder"));
        assert_eq!(run.steps[1].children[0].node_id, "inner");
    }

    #[test]
    fn sessions_json_alone_recovers_run_and_links_untagged_sessions() {
        let paths = temp_paths();
        let d = wf_dir(&paths);
        fs::write(d.join("workflow-state.json"), "{not json").unwrap();
        fs::write(d.join("workflow-definition.json"), "[]").unwrap();
        let sessions = json!({"workflowId": WF, "sessions": [
            {"nodeId": "a", "sessionId": "sess_a1"},
            {"nodeId": "b", "sessionId": "sess_b"},
            {"nodeId": "a", "sessionId": "sess_a2"}
        ]});
        fs::write(d.join("sessions.json"), sessions.to_string()).unwrap();
        let mut untagged = step_meta("sess_b", "b", 4.0, 1, 7);
        untagged.workflow = None;

        let runs = load_workflow_runs(&paths, &[untagged]);
        assert_eq!(runs.len(), 1);
        let run = &runs[0];
        assert_eq!(run.id, WF);
        let steps: Vec<(&str, Option<&str>)> = run
            .steps
            .iter()
            .map(|n| (n.node_id.as_str(), n.session_id.as_deref()))
            .collect();
        assert_eq!(steps, [("a", Some("sess_a2")), ("b", Some("sess_b"))]);
        assert_eq!(run.steps[1].credits, 4.0, "untagged linked session still fills in");
        assert_eq!(run.steps[1].model_id.as_deref(), Some("model-x"));
        assert_eq!(run.last_activity_at, 7);
    }

    #[test]
    fn workspace_path_prefers_step_session_cwd() {
        let run = WorkflowRun {
            id: WF.into(),
            name: String::new(),
            status: None,
            workspace_path: "/recorded".into(),
            parent_session_id: Some("p".into()),
            created_at: 0,
            last_activity_at: 0,
            total_credits: 0.0,
            steps: vec![WorkflowNode { session_id: Some("s".into()), ..Default::default() }],
        };
        let mut cwds = HashMap::new();
        assert_eq!(run_workspace_path(&run, &cwds), "/recorded");
        cwds.insert("p", "/parent");
        assert_eq!(run_workspace_path(&run, &cwds), "/parent");
        cwds.insert("s", "/step");
        assert_eq!(run_workspace_path(&run, &cwds), "/step");
    }
}
