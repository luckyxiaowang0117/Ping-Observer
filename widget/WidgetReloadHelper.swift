import AppKit
import WidgetKit

@main
struct WidgetReloadHelper {
    static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        let data = FileHandle.standardInput.readDataToEndOfFile()
        let group = Bundle.main.object(forInfoDictionaryKey: "PING0_APP_GROUP") as? String ?? ""
        guard !data.isEmpty, !group.isEmpty,
              let shared = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) else {
            fputs("Unable to access the Ping Observer shared data container.\n", stderr)
            exit(1)
        }
        let snapshot = shared.appendingPathComponent("ping-observer-widget.json")
        do { try data.write(to: snapshot, options: .atomic) }
        catch { fputs("Unable to write widget snapshot: \(error.localizedDescription)\n", stderr); exit(1) }

        WidgetCenter.shared.reloadTimelines(ofKind: "PingObserverMediumWidget")
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
            app.terminate(nil)
        }
        app.run()
    }
}
