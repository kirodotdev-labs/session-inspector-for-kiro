import SwiftUI

@main
struct KiroSessionsInspectorApp: App {
    @StateObject private var store = SessionsStore()

    var body: some Scene {
        WindowGroup("Kiro Sessions Inspector") {
            ContentView()
                .environmentObject(store)
                .frame(minWidth: 1000, minHeight: 700)
                .preferredColorScheme(.dark)
                .task { await store.loadWorkspaces() }
        }
        .windowStyle(.titleBar)
        .windowToolbarStyle(.unified)

        Settings {
            SettingsView()
                .preferredColorScheme(.dark)
        }
    }
}

/// App preferences (opened via the app menu or Cmd+,).
struct SettingsView: View {
    @AppStorage(AppSettings.showNonUnifiedKey) private var showNonUnified = true

    var body: some View {
        Form {
            Section {
                Toggle("Show non-unified sessions", isOn: $showNonUnified)
                Text("When off, legacy IDE and CLI (v2) sessions are hidden, leaving only Unified sessions — the shared format the IDE and CLI now both write.")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
            } header: {
                Text("Sessions")
            }
        }
        .formStyle(.grouped)
        .frame(width: 440)
        .padding(20)
    }
}
