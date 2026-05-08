import SwiftUI

enum SidebarSourceFilter: String, CaseIterable, Identifiable {
    case all, ide, cli
    var id: String { rawValue }
    var title: String {
        switch self {
        case .all: return "All"
        case .ide: return "IDE"
        case .cli: return "CLI"
        }
    }
}

struct SidebarView_: View {
    @EnvironmentObject private var store: SessionsStore
    @Binding var view: SidebarView
    @Binding var selectedSession: SelectedSession?
    let onSelect: (_ workspaceId: String, _ sessionId: String) -> Void

    @State private var expanded: Set<String> = []
    @State private var sourceFilter: SidebarSourceFilter = .all

    var body: some View {
        VStack(spacing: 0) {
            header
            tabs
            filterBar
            list
        }
        .frame(maxHeight: .infinity)
        .background(Theme.bgSecondary)
        .overlay(alignment: .trailing) {
            Rectangle().fill(Theme.border).frame(width: 1)
        }
    }

    // MARK: - Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("SESSIONS INSPECTOR")
                .font(.system(size: 12, weight: .semibold))
                .tracking(1.0)
                .foregroundStyle(Theme.accent)
            Text("\(store.workspaces.count) workspaces • \(totalSessions) sessions")
                .font(.system(size: 11))
                .foregroundStyle(Theme.textSecondary)
            HStack(spacing: 10) {
                sourceCounter(source: .ide, sessions: counts(for: .ide).sessions)
                sourceCounter(source: .cli, sessions: counts(for: .cli).sessions)
            }
            .padding(.top, 2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Theme.border).frame(height: 1)
        }
    }

    private func sourceCounter(source: SessionSource, sessions: Int) -> some View {
        HStack(spacing: 4) {
            Image(systemName: source == .cli ? "terminal" : "display")
                .font(.system(size: 9))
                .foregroundStyle(Theme.color(for: source))
            Text("\(source.label) \(sessions)")
                .font(.system(size: 10))
                .foregroundStyle(Theme.textSecondary)
        }
    }

    private var totalSessions: Int {
        store.workspaces.reduce(0) { $0 + $1.sessionCount }
    }

    private func counts(for source: SessionSource) -> (workspaces: Int, sessions: Int) {
        let list = store.workspaces.filter { $0.source == source }
        return (list.count, list.reduce(0) { $0 + $1.sessionCount })
    }

    // MARK: - Tabs

    private var tabs: some View {
        HStack(spacing: 0) {
            tabButton(title: "Dashboard", icon: "square.grid.2x2", tab: .dashboard)
            tabButton(title: "Sessions", icon: "list.bullet", tab: .sessions)
        }
        .overlay(alignment: .bottom) {
            Rectangle().fill(Theme.border).frame(height: 1)
        }
    }

    @ViewBuilder
    private func tabButton(title: String, icon: String, tab: SidebarView) -> some View {
        let active = view == tab
        Button {
            view = tab
        } label: {
            HStack(spacing: 6) {
                Image(systemName: icon).font(.system(size: 11))
                Text(title).font(.system(size: 12, weight: .medium))
            }
            .foregroundStyle(active ? Theme.accent : Theme.textSecondary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .overlay(alignment: .bottom) {
                if active {
                    Rectangle().fill(Theme.accent).frame(height: 2)
                }
            }
        }
        .buttonStyle(.plain)
    }

    // MARK: - Source filter

    private var filterBar: some View {
        HStack(spacing: 4) {
            ForEach(SidebarSourceFilter.allCases) { f in
                let active = sourceFilter == f
                Button {
                    sourceFilter = f
                } label: {
                    HStack(spacing: 4) {
                        if f == .ide { Image(systemName: "display").font(.system(size: 9)) }
                        if f == .cli { Image(systemName: "terminal").font(.system(size: 9)) }
                        Text(f.title).font(.system(size: 11))
                    }
                    .foregroundStyle(active ? Theme.textPrimary : Theme.textSecondary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 4)
                    .background(
                        RoundedRectangle(cornerRadius: 4)
                            .fill(active ? Theme.bgTertiary : Color.clear)
                    )
                }
                .buttonStyle(.plain)
            }
        }
        .padding(8)
        .background(Theme.bgPrimary.opacity(0.2))
        .overlay(alignment: .bottom) {
            Rectangle().fill(Theme.border).frame(height: 1)
        }
    }

    // MARK: - Workspaces list

    private var visibleWorkspaces: [Workspace] {
        switch sourceFilter {
        case .all: return store.workspaces
        case .ide: return store.workspaces.filter { $0.source == .ide }
        case .cli: return store.workspaces.filter { $0.source == .cli }
        }
    }

    private var list: some View {
        ScrollView {
            LazyVStack(spacing: 4) {
                ForEach(SessionSource.allCases, id: \.self) { source in
                    let list = visibleWorkspaces.filter { $0.source == source }
                    if !list.isEmpty {
                        sectionHeader(for: source, count: list.count)
                        ForEach(list) { ws in
                            workspaceRow(ws)
                            if expanded.contains(ws.id) {
                                sessionsList(for: ws)
                            }
                        }
                    }
                }

                if visibleWorkspaces.isEmpty {
                    Text("No workspaces for this filter.")
                        .font(.system(size: 11))
                        .foregroundStyle(Theme.textSecondary)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 24)
                }
            }
            .padding(8)
        }
    }

    private func sectionHeader(for source: SessionSource, count: Int) -> some View {
        HStack(spacing: 6) {
            Image(systemName: source == .cli ? "terminal" : "display")
                .font(.system(size: 10))
                .foregroundStyle(Theme.color(for: source))
            Text(source.label.uppercased())
                .font(.system(size: 10, weight: .semibold))
                .tracking(0.8)
                .foregroundStyle(Theme.color(for: source))
            Spacer()
            Text("\(count)")
                .font(.system(size: 10).monospacedDigit())
                .foregroundStyle(Theme.textSecondary)
        }
        .padding(.horizontal, 8)
        .padding(.top, 6)
        .padding(.bottom, 2)
    }

    private func workspaceRow(_ ws: Workspace) -> some View {
        Button {
            toggle(ws.id)
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "chevron.right")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(Theme.textSecondary)
                    .rotationEffect(expanded.contains(ws.id) ? .degrees(90) : .zero)
                    .animation(.easeInOut(duration: 0.15), value: expanded.contains(ws.id))

                Image(systemName: ws.source == .cli ? "terminal.fill" : "folder.fill")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.color(for: ws.source))

                Text(ws.name)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .frame(maxWidth: .infinity, alignment: .leading)

                Text("\(ws.sessionCount)")
                    .font(.system(size: 11).monospacedDigit())
                    .foregroundStyle(Theme.textSecondary)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .frame(maxWidth: .infinity)
            .contentShape(Rectangle())
        }
        .buttonStyle(HoverRowStyle())
    }

    private func sessionsList(for ws: Workspace) -> some View {
        VStack(spacing: 2) {
            ForEach(ws.sessions.sorted(by: { $0.date > $1.date })) { s in
                sessionRow(ws: ws, session: s)
            }
        }
        .padding(.leading, 20)
        .overlay(alignment: .leading) {
            Rectangle()
                .fill(Theme.border)
                .frame(width: 1)
                .padding(.leading, 16)
        }
    }

    @ViewBuilder
    private func sessionRow(ws: Workspace, session: SessionSummary) -> some View {
        let selected = selectedSession?.sessionId == session.id
        let selectedColor: Color = ws.source == .cli ? Theme.cliAccent : Theme.accent
        Button {
            onSelect(ws.id, session.id)
        } label: {
            HStack(spacing: 8) {
                Image(systemName: ws.source == .cli ? "terminal" : "message")
                    .font(.system(size: 11))
                    .foregroundStyle(ws.source == .cli ? Theme.cliAccent : Theme.textSecondary)
                Text(session.title.isEmpty ? "Untitled session" : session.title)
                    .font(.system(size: 12))
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .foregroundStyle(selected ? selectedColor : Theme.textSecondary)
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .frame(maxWidth: .infinity)
            .background(
                RoundedRectangle(cornerRadius: 6)
                    .fill(selected ? selectedColor.opacity(0.15) : Color.clear)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(HoverRowStyle())
    }

    private func toggle(_ id: String) {
        if expanded.contains(id) {
            expanded.remove(id)
        } else {
            expanded.insert(id)
        }
    }
}

extension SessionSource {
    var label: String {
        switch self {
        case .ide: return "IDE"
        case .cli: return "CLI"
        }
    }
}

/// Plain button style with a subtle hover fill.
private struct HoverRowStyle: ButtonStyle {
    @State private var hovering = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(
                RoundedRectangle(cornerRadius: 6)
                    .fill(hovering ? Theme.bgTertiary : Color.clear)
            )
            .onHover { hovering = $0 }
            .opacity(configuration.isPressed ? 0.8 : 1)
    }
}
