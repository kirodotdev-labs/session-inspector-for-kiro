import SwiftUI

/// A workspace path that may aggregate both IDE and CLI sources.
struct UnifiedWorkspace: Identifiable {
    var id: String { path.isEmpty ? name : path }
    let path: String
    let name: String
    var bySource: [SessionSource: Workspace]
    var sessionCount: Int
    var sources: [SessionSource]
}

private func groupByPath(_ workspaces: [Workspace]) -> [UnifiedWorkspace] {
    var map: [String: UnifiedWorkspace] = [:]
    var order: [String] = []
    for ws in workspaces {
        let key = ws.path.isEmpty ? ws.name : ws.path
        if var entry = map[key] {
            entry.bySource[ws.source] = ws
            entry.sessionCount += ws.sessionCount
            if !entry.sources.contains(ws.source) { entry.sources.append(ws.source) }
            map[key] = entry
        } else {
            map[key] = UnifiedWorkspace(
                path: ws.path,
                name: ws.name,
                bySource: [ws.source: ws],
                sessionCount: ws.sessionCount,
                sources: [ws.source]
            )
            order.append(key)
        }
    }
    return order.compactMap { map[$0] }.sorted { $0.sessionCount > $1.sessionCount }
}

struct WorkspacesScreen: View {
    @EnvironmentObject private var store: SessionsStore
    let onSelectSession: (String, String) -> Void

    @State private var selected: UnifiedWorkspace?

    /// When false, only Unified (shared IDE+CLI) sessions are listed.
    @AppStorage(AppSettings.showNonUnifiedKey) private var showNonUnified = true

    var body: some View {
        Group {
            if let selected {
                WorkspaceDashboardView(
                    workspace: selected,
                    onBack: { self.selected = nil },
                    onSelectSession: onSelectSession
                )
            } else {
                list
            }
        }
        .task { if store.workspaces.isEmpty { await store.loadWorkspaces() } }
    }

    private var unified: [UnifiedWorkspace] {
        let source = showNonUnified
            ? store.workspaces
            : store.workspaces.filter { $0.source == .unified }
        return groupByPath(source)
    }

    private var list: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("Workspaces")
                        .font(.system(size: 18, weight: .medium))
                        .foregroundStyle(Theme.textPrimary)
                    Spacer()
                    Text("\(unified.count) workspaces")
                        .font(.system(size: 11))
                        .foregroundStyle(Theme.textSecondary)
                }

                VStack(spacing: 8) {
                    ForEach(unified) { ws in
                        WorkspaceRow(
                            workspace: ws,
                            onOpenDashboard: { selected = ws },
                            onSelectSession: onSelectSession
                        )
                    }
                }
            }
            .padding(24)
            .frame(maxWidth: 960, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .top)
        }
    }
}

// MARK: - Workspace row (collapsible)

private struct WorkspaceRow: View {
    let workspace: UnifiedWorkspace
    let onOpenDashboard: () -> Void
    let onSelectSession: (String, String) -> Void

    @State private var expanded = false

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Button {
                    expanded.toggle()
                } label: {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.textSecondary)
                        .rotationEffect(.degrees(expanded ? 90 : 0))
                }
                .buttonStyle(.plain)

                Image(systemName: "folder")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.accent)

                Button(action: onOpenDashboard) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(workspace.name)
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(Theme.textPrimary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                        Text(workspace.path)
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundStyle(Theme.textSecondary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.plain)

                ForEach(workspace.sources, id: \.self) { src in
                    SourceCountChip(
                        source: src,
                        count: workspace.bySource[src]?.sessionCount ?? 0
                    )
                }

                Button(action: onOpenDashboard) {
                    HStack(spacing: 4) {
                        Image(systemName: "chart.bar.xaxis").font(.system(size: 11))
                        Text("Dashboard").font(.system(size: 11))
                    }
                    .foregroundStyle(Theme.textSecondary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(RoundedRectangle(cornerRadius: 6).fill(Theme.bgTertiary))
                }
                .buttonStyle(.plain)
            }
            .padding(12)

            if expanded {
                Divider().background(Theme.border)
                SessionGroups(workspace: workspace, onSelectSession: onSelectSession)
                    .padding(12)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .themeCard()
    }
}

// MARK: - Per-source session groups

private struct SessionGroups: View {
    let workspace: UnifiedWorkspace
    let onSelectSession: (String, String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(SessionSource.allCases, id: \.self) { source in
                if let ws = workspace.bySource[source], !ws.sessions.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 6) {
                            Image(systemName: source.iconName)
                                .font(.system(size: 10))
                            Text(source.label)
                                .font(.system(size: 10, weight: .semibold))
                                .tracking(0.8)
                            Text("\(ws.sessions.count)")
                                .font(.system(size: 10))
                                .foregroundStyle(Theme.textSecondary)
                        }
                        .foregroundStyle(Theme.color(for: source))

                        VStack(spacing: 2) {
                            ForEach(ws.sessions.sorted { $0.date > $1.date }) { s in
                                Button {
                                    onSelectSession(ws.id, s.id)
                                } label: {
                                    HStack(spacing: 8) {
                                        Image(systemName: source == .ide ? "message" : source.iconName)
                                            .font(.system(size: 11))
                                            .foregroundStyle(Theme.color(for: source))
                                        Text(s.title.isEmpty ? "Untitled session" : s.title)
                                            .font(.system(size: 12))
                                            .foregroundStyle(Theme.textSecondary)
                                            .lineLimit(1)
                                            .truncationMode(.middle)
                                        Spacer()
                                    }
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 5)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(.leading, 8)
                        .overlay(alignment: .leading) {
                            Rectangle().fill(Theme.border).frame(width: 1)
                        }
                    }
                }
            }
        }
    }
}

private struct SourceCountChip: View {
    let source: SessionSource
    let count: Int

    var body: some View {
        let color = Theme.color(for: source)
        HStack(spacing: 3) {
            Image(systemName: source.iconName)
                .font(.system(size: 9))
            Text("\(count)")
                .font(.system(size: 10, weight: .semibold))
        }
        .foregroundStyle(color)
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .background(RoundedRectangle(cornerRadius: 4).fill(color.opacity(0.1)))
        .overlay(RoundedRectangle(cornerRadius: 4).stroke(color.opacity(0.3), lineWidth: 1))
    }
}

// MARK: - Scoped per-workspace dashboard

private struct WorkspaceDashboardView: View {
    @EnvironmentObject private var store: SessionsStore
    let workspace: UnifiedWorkspace
    let onBack: () -> Void
    let onSelectSession: (String, String) -> Void

    @State private var data: DashboardData?
    @State private var loading = true

    /// When false, the workspace dashboard summarizes only Unified sessions.
    @AppStorage(AppSettings.showNonUnifiedKey) private var showNonUnified = true

    var body: some View {
        VStack(spacing: 0) {
            // Breadcrumb header
            HStack(spacing: 8) {
                Button(action: onBack) {
                    HStack(spacing: 4) {
                        Image(systemName: "chevron.left").font(.system(size: 12))
                        Text("All workspaces").font(.system(size: 13))
                    }
                    .foregroundStyle(Theme.textSecondary)
                }
                .buttonStyle(.plain)
                Text("/").foregroundStyle(Theme.textSecondary)
                Text(workspace.name)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer()
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 12)
            .background(Theme.bgSecondary)
            .overlay(alignment: .bottom) {
                Rectangle().fill(Theme.border).frame(height: 1)
            }

            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    if loading {
                        Text("Loading dashboard...")
                            .foregroundStyle(Theme.textSecondary)
                    } else if let data {
                        DashboardContentView(data: data, title: "\(workspace.name) — Dashboard")
                        SessionGroups(workspace: workspace, onSelectSession: onSelectSession)
                            .padding(16)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .themeCard()
                    } else {
                        Text("Failed to load dashboard")
                            .foregroundStyle(Theme.textSecondary)
                    }
                }
                .padding(24)
                .frame(maxWidth: 960, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .top)
            }
        }
        .task(id: "\(workspace.id)|\(showNonUnified)") {
            loading = true
            data = await store.workspaceDashboard(
                path: workspace.path,
                sourceFilter: showNonUnified ? nil : .unified
            )
            loading = false
        }
    }
}
