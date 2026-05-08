import SwiftUI
import Charts

struct DashboardScreen: View {
    @EnvironmentObject private var store: SessionsStore

    var body: some View {
        ScrollView {
            content
                .padding(24)
                .frame(maxWidth: 960, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .top)
        }
        .task {
            if store.dashboard == nil { await store.loadDashboard() }
        }
    }

    @ViewBuilder
    private var content: some View {
        if store.isLoadingDashboard {
            Text("Loading dashboard...")
                .foregroundStyle(Theme.textSecondary)
        } else if let data = store.dashboard {
            dashboard(data)
        } else {
            Text("Failed to load dashboard")
                .foregroundStyle(Theme.textSecondary)
        }
    }

    @ViewBuilder
    private func dashboard(_ data: DashboardData) -> some View {
        VStack(alignment: .leading, spacing: 24) {
            Text("Usage Dashboard")
                .font(.system(size: 18, weight: .medium))
                .foregroundStyle(Theme.textPrimary)

            // Summary cards
            HStack(spacing: 16) {
                StatCard(icon: "dollarsign.circle", label: "Total Credits",
                         value: String(format: "%.1f", data.totalCost))
                StatCard(icon: "square.stack.3d.up", label: "Sessions",
                         value: "\(data.totalSessions)")
                StatCard(icon: "bolt", label: "Executions",
                         value: "\(data.totalExecutions)")
                StatCard(icon: "chart.line.uptrend.xyaxis", label: "Avg/Session",
                         value: String(format: "%.2f", data.totalCost / Double(max(data.totalSessions, 1))))
            }

            // Source breakdown (IDE vs CLI)
            HStack(spacing: 16) {
                SourceCard(
                    source: .ide,
                    stats: data.sourceStats[.ide] ?? SourceStats(sessions: 0, executions: 0, cost: 0),
                    totalSessions: data.totalSessions,
                    totalCost: data.totalCost
                )
                SourceCard(
                    source: .cli,
                    stats: data.sourceStats[.cli] ?? SourceStats(sessions: 0, executions: 0, cost: 0),
                    totalSessions: data.totalSessions,
                    totalCost: data.totalCost
                )
            }

            // Daily activity (last 30 days)
            DailyActivityCard(data: last30Days(from: data))

            // Weekly spend
            WeeklySpendCard(weeks: weeks(from: data))

            // Breakdown row
            HStack(alignment: .top, spacing: 16) {
                BreakdownCard(
                    title: "Session Type",
                    items: sortedCounts(data.sessionTypes),
                    total: data.totalSessions
                ) { key in
                    switch key {
                    case "spec": return Theme.blue
                    case "cli":  return Theme.cliAccent
                    default:     return Theme.purple
                    }
                }

                BreakdownCard(
                    title: "Autonomy / Agent",
                    items: sortedCounts(data.autonomyModes),
                    total: data.totalSessions
                ) { key in
                    if key == "Autopilot" { return Theme.green }
                    if key.contains("kiro") { return Theme.cliAccent }
                    return Theme.amber
                }

                BreakdownCard(
                    title: "Model Usage",
                    items: sortedCounts(data.modelSessions),
                    total: data.totalSessions
                ) { _ in Theme.accent }
            }

            // Top workspaces
            WorkspacesCard(workspaces: Array(data.workspaces.prefix(10)))
        }
    }

    // MARK: - Helpers

    private func sortedCounts(_ map: [String: Int]) -> [(key: String, value: Int)] {
        map.sorted { $0.value > $1.value }.map { ($0.key, $0.value) }
    }

    private func last30Days(from data: DashboardData) -> [DailyStats] {
        let cal = Calendar(identifier: .iso8601)
        let today = cal.startOfDay(for: Date())
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withFullDate]

        let existing = Dictionary(uniqueKeysWithValues: data.daily.map { ($0.date, $0) })
        var results: [DailyStats] = []
        for i in stride(from: 29, through: 0, by: -1) {
            guard let date = cal.date(byAdding: .day, value: -i, to: today) else { continue }
            let key = formatter.string(from: date)
            results.append(existing[key] ?? DailyStats(
                date: key,
                sessions: 0, cost: 0, executions: 0,
                ideSessions: 0, cliSessions: 0,
                ideCost: 0, cliCost: 0,
                ideExecutions: 0, cliExecutions: 0
            ))
        }
        return results
    }

    private func weeks(from data: DashboardData) -> [WeeklyStats] {
        let cal = Calendar(identifier: .iso8601)
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withFullDate]

        var map: [String: WeeklyStats] = [:]
        for d in data.daily {
            guard let date = formatter.date(from: d.date) else { continue }
            let weekday = cal.component(.weekday, from: date) // 1 = Sunday
            let daysFromSunday = weekday - 1
            guard let weekStart = cal.date(byAdding: .day, value: -daysFromSunday, to: date) else { continue }
            let key = formatter.string(from: weekStart)
            var existing = map[key] ?? WeeklyStats(
                week: key, cost: 0, sessions: 0, executions: 0, ideCost: 0, cliCost: 0
            )
            existing.cost += d.cost
            existing.sessions += d.sessions
            existing.executions += d.executions
            existing.ideCost += d.ideCost
            existing.cliCost += d.cliCost
            map[key] = existing
        }
        return map.values.sorted { $0.week < $1.week }
    }
}

// MARK: - Weekly aggregate (local to dashboard)

struct WeeklyStats: Identifiable {
    var id: String { week }
    let week: String
    var cost: Double
    var sessions: Int
    var executions: Int
    var ideCost: Double
    var cliCost: Double
}

// MARK: - Legend

private struct SourceLegend: View {
    var body: some View {
        HStack(spacing: 12) {
            legendItem(color: Theme.accent, label: "IDE")
            legendItem(color: Theme.cliAccent, label: "CLI")
        }
    }

    private func legendItem(color: Color, label: String) -> some View {
        HStack(spacing: 4) {
            RoundedRectangle(cornerRadius: 2)
                .fill(color)
                .frame(width: 10, height: 10)
            Text(label)
                .font(.system(size: 10))
                .foregroundStyle(Theme.textSecondary)
        }
    }
}

// MARK: - Stat card

private struct StatCard: View {
    let icon: String
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Image(systemName: icon).font(.system(size: 11))
                Text(label).font(.system(size: 11))
            }
            .foregroundStyle(Theme.textSecondary)

            Text(value)
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(Theme.textPrimary)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .themeCard()
    }
}

// MARK: - Source card

private struct SourceCard: View {
    let source: SessionSource
    let stats: SourceStats
    let totalSessions: Int
    let totalCost: Double

    var body: some View {
        let color = Theme.color(for: source)
        let sessionPct = totalSessions > 0
            ? Double(stats.sessions) / Double(totalSessions) * 100
            : 0
        let costPct = totalCost > 0 ? stats.cost / totalCost * 100 : 0

        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 6) {
                Image(systemName: source == .cli ? "terminal" : "display")
                    .font(.system(size: 12))
                Text(source == .cli ? "KIRO CLI" : "KIRO IDE")
                    .font(.system(size: 11, weight: .semibold))
                    .tracking(0.8)
            }
            .foregroundStyle(color)

            HStack(alignment: .top, spacing: 12) {
                metric(title: "Sessions",
                       value: "\(stats.sessions)",
                       subtitle: String(format: "%.0f%% of all", sessionPct))
                metric(title: "Executions",
                       value: "\(stats.executions)",
                       subtitle: nil)
                metric(title: "Credits",
                       value: String(format: "%.1f", stats.cost),
                       subtitle: String(format: "%.0f%% of spend", costPct))
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(color.opacity(0.06))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(color.opacity(0.3), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private func metric(title: String, value: String, subtitle: String?) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.system(size: 10))
                .foregroundStyle(Theme.textSecondary)
            Text(value)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(Theme.textPrimary)
            if let subtitle {
                Text(subtitle)
                    .font(.system(size: 9))
                    .foregroundStyle(Theme.textSecondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Daily activity card (Swift Charts)

private struct DailyBar: Identifiable {
    let id: String            // unique per-bar id (date + source)
    let date: Date
    let dateKey: String       // yyyy-MM-dd
    let source: SessionSource
    let cost: Double
}

private struct DailyActivityCard: View {
    let data: [DailyStats]

    /// One bar entry per day per source (only emit non-zero segments).
    private var bars: [DailyBar] {
        var result: [DailyBar] = []
        result.reserveCapacity(data.count * 2)
        for day in data {
            guard let d = Self.parseDay(day.date) else { continue }
            // Emit IDE first so it renders on top of CLI in the stack, matching legend order.
            if day.cliCost > 0 {
                result.append(DailyBar(
                    id: "\(day.date):cli", date: d, dateKey: day.date,
                    source: .cli, cost: day.cliCost
                ))
            }
            if day.ideCost > 0 {
                result.append(DailyBar(
                    id: "\(day.date):ide", date: d, dateKey: day.date,
                    source: .ide, cost: day.ideCost
                ))
            }
        }
        return result
    }

    private var domain: ClosedRange<Date>? {
        guard
            let firstKey = data.first?.date,
            let lastKey = data.last?.date,
            let first = Self.parseDay(firstKey),
            let last = Self.parseDay(lastKey)
        else { return nil }
        let cal = Self.utcCalendar
        let start = cal.date(byAdding: .hour, value: -12, to: first) ?? first
        let end = cal.date(byAdding: .hour, value: 12, to: last) ?? last
        return start...end
    }

    @State private var selectedDate: Date?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Daily Activity (Last 30 Days)")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
                Spacer()
                SourceLegend()
            }

            Chart(bars) { bar in
                BarMark(
                    x: .value("Day", bar.date, unit: .day),
                    y: .value("Credits", bar.cost)
                )
                .foregroundStyle(by: .value("Source", bar.source.label))
                .accessibilityLabel(Text(bar.dateKey))
                .accessibilityValue(Text(String(
                    format: "%@ %.2f credits", bar.source.label, bar.cost
                )))
            }
            .chartForegroundStyleScale([
                SessionSource.ide.label: Theme.accent,
                SessionSource.cli.label: Theme.cliAccent,
            ])
            .chartLegend(.hidden)
            .chartXAxis {
                AxisMarks(values: .stride(by: .day)) { _ in
                    AxisValueLabel(
                        format: .dateTime.weekday(.narrow),
                        centered: true
                    )
                    .font(.system(size: 9, design: .monospaced))
                }
            }
            .chartYAxis {
                AxisMarks(position: .leading) { value in
                    AxisGridLine().foregroundStyle(Theme.border.opacity(0.5))
                    AxisValueLabel().font(.system(size: 9))
                }
            }
            .applyXDomain(domain)
            .chartXSelection(value: $selectedDate)
            .chartOverlay { proxy in
                GeometryReader { geo in
                    if let selectedDate, let stats = statsForSelection(selectedDate) {
                        tooltip(for: stats, proxy: proxy, geo: geo)
                    }
                }
            }
            .frame(height: 160)

            if let first = data.first?.date, let last = data.last?.date {
                HStack {
                    Text(first)
                    Spacer()
                    Text(last)
                }
                .font(.system(size: 10))
                .foregroundStyle(Theme.textSecondary)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .themeCard()
    }

    private func statsForSelection(_ date: Date) -> DailyStats? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withFullDate]
        formatter.timeZone = TimeZone(identifier: "UTC")
        let key = formatter.string(from: Self.utcCalendar.startOfDay(for: date))
        return data.first(where: { $0.date == key })
    }

    @ViewBuilder
    private func tooltip(for stats: DailyStats, proxy: ChartProxy, geo: GeometryProxy) -> some View {
        if let plotFrame = proxy.plotFrame,
           let d = Self.parseDay(stats.date) {
            let plot = geo[plotFrame]
            let raw = proxy.position(forX: d) ?? 0
            // position(forX:) returns a point *relative to the plot*, so add plot.minX.
            let cursorX = min(max(raw + plot.minX, plot.minX), plot.maxX)

            // Vertical rule marker at the selected date.
            Rectangle()
                .fill(Theme.border)
                .frame(width: 1, height: plot.height)
                .position(x: cursorX, y: plot.midY)

            // Tooltip card, centered above the bar and clamped inside the chart.
            TooltipCard(stats: stats)
                .fixedSize()
                .modifier(TooltipPositioner(
                    cursorX: cursorX,
                    containerWidth: geo.size.width,
                    topY: plot.minY
                ))
        }
    }

    private static func parseDay(_ key: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withFullDate]
        formatter.timeZone = TimeZone(identifier: "UTC")
        guard let day = formatter.date(from: key) else { return nil }
        // Anchor to noon UTC so `unit: .day` bars line up regardless of local TZ.
        return utcCalendar.date(byAdding: .hour, value: 12, to: day) ?? day
    }

    private static var utcCalendar: Calendar {
        var cal = Calendar(identifier: .iso8601)
        cal.timeZone = TimeZone(identifier: "UTC") ?? .current
        return cal
    }
}

/// Conditional chartXScale domain.
private extension View {
    @ViewBuilder
    func applyXDomain(_ domain: ClosedRange<Date>?) -> some View {
        if let domain {
            self.chartXScale(domain: domain)
        } else {
            self
        }
    }
}

/// Positions the tooltip centered above the cursor, keeping it inside the card.
private struct TooltipPositioner: ViewModifier {
    let cursorX: CGFloat
    let containerWidth: CGFloat
    let topY: CGFloat

    @State private var tooltipSize: CGSize = .zero

    func body(content: Content) -> some View {
        content
            .background(
                GeometryReader { proxy in
                    Color.clear.preference(
                        key: TooltipSizeKey.self,
                        value: proxy.size
                    )
                }
            )
            .onPreferenceChange(TooltipSizeKey.self) { tooltipSize = $0 }
            .position(x: resolvedX, y: resolvedY)
    }

    /// Clamp the center-X so the tooltip stays fully inside the chart width.
    private var resolvedX: CGFloat {
        let half = tooltipSize.width / 2
        let minX = half + 4
        let maxX = max(minX, containerWidth - half - 4)
        return min(max(cursorX, minX), maxX)
    }

    /// Sit just above the plot area, with the tooltip's center at (topY - height/2 - 6).
    private var resolvedY: CGFloat {
        max(tooltipSize.height / 2, topY - tooltipSize.height / 2 - 6)
    }
}

private struct TooltipSizeKey: PreferenceKey {
    static let defaultValue: CGSize = .zero
    static func reduce(value: inout CGSize, nextValue: () -> CGSize) {
        value = nextValue()
    }
}

private struct TooltipCard: View {
    let stats: DailyStats

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(formattedDate)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Theme.textPrimary)
            row(color: Theme.accent, label: "IDE",
                credits: stats.ideCost, execs: stats.ideExecutions)
            row(color: Theme.cliAccent, label: "CLI",
                credits: stats.cliCost, execs: stats.cliExecutions)
            Divider().background(Theme.border)
            HStack(spacing: 6) {
                Text("Total")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
                Spacer()
                Text(String(format: "%.2f cr · %d execs", stats.cost, stats.executions))
                    .font(.system(size: 10, weight: .medium).monospacedDigit())
                    .foregroundStyle(Theme.textPrimary)
            }
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 6)
                .fill(Theme.bgTertiary)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 6)
                .stroke(Theme.border, lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.25), radius: 6, x: 0, y: 2)
    }

    private var formattedDate: String {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withFullDate]
        iso.timeZone = TimeZone(identifier: "UTC")
        guard let d = iso.date(from: stats.date) else { return stats.date }
        let f = DateFormatter()
        f.dateFormat = "EEE, MMM d"
        f.timeZone = TimeZone(identifier: "UTC")
        return f.string(from: d)
    }

    private func row(color: Color, label: String, credits: Double, execs: Int) -> some View {
        HStack(spacing: 6) {
            RoundedRectangle(cornerRadius: 2)
                .fill(color)
                .frame(width: 8, height: 8)
            Text(label)
                .font(.system(size: 10))
                .foregroundStyle(Theme.textSecondary)
            Spacer()
            Text(String(format: "%.2f cr · %d", credits, execs))
                .font(.system(size: 10).monospacedDigit())
                .foregroundStyle(Theme.textPrimary)
        }
    }
}

// MARK: - Weekly spend card

private struct WeeklySpendCard: View {
    let weeks: [WeeklyStats]

    var body: some View {
        let recent = Array(weeks.suffix(8))
        let maxCost = max(recent.map { $0.cost }.max() ?? 0, 0.01)

        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Weekly Spend")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
                Spacer()
                SourceLegend()
            }

            VStack(spacing: 4) {
                ForEach(recent) { w in
                    HStack(spacing: 8) {
                        Text(w.week)
                            .font(.system(size: 11))
                            .foregroundStyle(Theme.textSecondary)
                            .frame(width: 80, alignment: .leading)

                        GeometryReader { geo in
                            let totalWidth = geo.size.width * CGFloat(w.cost / maxCost)
                            let ideWidth = w.cost > 0
                                ? totalWidth * CGFloat(w.ideCost / w.cost)
                                : 0
                            let cliWidth = max(0, totalWidth - ideWidth)

                            ZStack(alignment: .leading) {
                                Rectangle().fill(Theme.bgTertiary)
                                HStack(spacing: 0) {
                                    Rectangle()
                                        .fill(Theme.accent.opacity(0.85))
                                        .frame(width: ideWidth)
                                        .help(String(format: "IDE %.2f cr", w.ideCost))
                                    Rectangle()
                                        .fill(Theme.cliAccent.opacity(0.85))
                                        .frame(width: cliWidth)
                                        .help(String(format: "CLI %.2f cr", w.cliCost))
                                }
                            }
                            .clipShape(RoundedRectangle(cornerRadius: 2))
                        }
                        .frame(height: 16)

                        Text(String(format: "%.1f cr", w.cost))
                            .font(.system(size: 11))
                            .foregroundStyle(Theme.textPrimary)
                            .frame(width: 80, alignment: .trailing)
                    }
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .themeCard()
    }
}

// MARK: - Breakdown card

private struct BreakdownCard: View {
    let title: String
    let items: [(key: String, value: Int)]
    let total: Int
    let color: (String) -> Color

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Theme.textSecondary)

            VStack(spacing: 8) {
                ForEach(items, id: \.key) { item in
                    let pct = total > 0 ? Double(item.value) / Double(total) * 100 : 0
                    VStack(spacing: 4) {
                        HStack {
                            Text(item.key)
                                .font(.system(size: 11))
                                .foregroundStyle(Theme.textPrimary)
                                .lineLimit(1)
                            Spacer()
                            Text("\(item.value) (\(Int(pct))%)")
                                .font(.system(size: 11))
                                .foregroundStyle(Theme.textSecondary)
                        }

                        GeometryReader { geo in
                            ZStack(alignment: .leading) {
                                Rectangle().fill(Theme.bgTertiary)
                                Rectangle()
                                    .fill(color(item.key))
                                    .frame(width: geo.size.width * CGFloat(pct / 100))
                            }
                            .clipShape(RoundedRectangle(cornerRadius: 2))
                        }
                        .frame(height: 8)
                    }
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .top)
        .themeCard()
    }
}

// MARK: - Workspaces card

private struct WorkspacesCard: View {
    let workspaces: [WorkspaceStats]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Top Workspaces by Spend")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Theme.textSecondary)

            VStack(spacing: 6) {
                ForEach(workspaces) { ws in
                    HStack(spacing: 12) {
                        Image(systemName: ws.source == .cli ? "terminal" : "folder")
                            .font(.system(size: 11))
                            .foregroundStyle(
                                ws.source == .cli ? Theme.cliAccent : Theme.textSecondary
                            )
                        Text(ws.name)
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.textPrimary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                            .frame(maxWidth: .infinity, alignment: .leading)

                        SourceBadge(source: ws.source)

                        Text("\(ws.sessions) sessions")
                            .font(.system(size: 11))
                            .foregroundStyle(Theme.textSecondary)
                        Text("\(ws.executions) execs")
                            .font(.system(size: 11))
                            .foregroundStyle(Theme.textSecondary)
                        Text(String(format: "%.1f cr", ws.cost))
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(Theme.textPrimary)
                            .frame(width: 80, alignment: .trailing)
                    }
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .themeCard()
    }
}

private struct SourceBadge: View {
    let source: SessionSource

    var body: some View {
        let color = Theme.color(for: source)
        Text(source.rawValue.uppercased())
            .font(.system(size: 9, weight: .semibold))
            .tracking(0.8)
            .foregroundStyle(color)
            .padding(.horizontal, 5)
            .padding(.vertical, 1)
            .background(
                RoundedRectangle(cornerRadius: 3)
                    .fill(color.opacity(0.1))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 3)
                    .stroke(color.opacity(0.3), lineWidth: 1)
            )
    }
}

// MARK: - Rounded corner helper

private struct RoundedCorner: Shape {
    var radius: CGFloat = .zero
    var corners: RectCorner = .allCorners

    func path(in rect: CGRect) -> Path {
        let radii: CGFloat = radius
        var path = Path()
        let topLeft = CGPoint(x: rect.minX, y: rect.minY)
        let topRight = CGPoint(x: rect.maxX, y: rect.minY)
        let bottomLeft = CGPoint(x: rect.minX, y: rect.maxY)
        let bottomRight = CGPoint(x: rect.maxX, y: rect.maxY)

        path.move(to: CGPoint(x: rect.minX + (corners.contains(.topLeft) ? radii : 0), y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX - (corners.contains(.topRight) ? radii : 0), y: rect.minY))
        if corners.contains(.topRight) {
            path.addArc(tangent1End: topRight, tangent2End: CGPoint(x: rect.maxX, y: rect.minY + radii), radius: radii)
        }
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - (corners.contains(.bottomRight) ? radii : 0)))
        if corners.contains(.bottomRight) {
            path.addArc(tangent1End: bottomRight, tangent2End: CGPoint(x: rect.maxX - radii, y: rect.maxY), radius: radii)
        }
        path.addLine(to: CGPoint(x: rect.minX + (corners.contains(.bottomLeft) ? radii : 0), y: rect.maxY))
        if corners.contains(.bottomLeft) {
            path.addArc(tangent1End: bottomLeft, tangent2End: CGPoint(x: rect.minX, y: rect.maxY - radii), radius: radii)
        }
        path.addLine(to: CGPoint(x: rect.minX, y: rect.minY + (corners.contains(.topLeft) ? radii : 0)))
        if corners.contains(.topLeft) {
            path.addArc(tangent1End: topLeft, tangent2End: CGPoint(x: rect.minX + radii, y: rect.minY), radius: radii)
        }
        path.closeSubpath()
        return path
    }
}

private struct RectCorner: OptionSet {
    let rawValue: Int
    static let topLeft     = RectCorner(rawValue: 1 << 0)
    static let topRight    = RectCorner(rawValue: 1 << 1)
    static let bottomLeft  = RectCorner(rawValue: 1 << 2)
    static let bottomRight = RectCorner(rawValue: 1 << 3)
    static let allCorners: RectCorner = [.topLeft, .topRight, .bottomLeft, .bottomRight]
}
