import SwiftUI
import WidgetKit

private let appGroupID = Bundle.main.object(forInfoDictionaryKey: "PING0_APP_GROUP") as? String ?? ""
private let snapshotName = "ping-observer-widget.json"

struct PingSnapshot: Decodable {
    struct Current: Decodable {
        let location: String?
        let riskValue: Int?
        let riskLabel: String?
        let sharedUsers: String?
        let checkedAt: Double?
    }
    let current: Current?
    let updatedAt: Double?

    static func load() -> PingSnapshot {
        guard !appGroupID.isEmpty,
              let folder = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupID),
              let data = try? Data(contentsOf: folder.appendingPathComponent(snapshotName)),
              let value = try? JSONDecoder().decode(PingSnapshot.self, from: data) else {
            return PingSnapshot(current: nil, updatedAt: nil)
        }
        return value
    }
}

struct PingEntry: TimelineEntry {
    let date: Date
    let snapshot: PingSnapshot
}

struct PingProvider: TimelineProvider {
    func placeholder(in context: Context) -> PingEntry {
        PingEntry(date: .now, snapshot: PingSnapshot(current: .init(location: "中国 · 上海", riskValue: 24, riskLabel: "纯净", sharedUsers: "10–100", checkedAt: Date.now.timeIntervalSince1970 * 1000), updatedAt: Date.now.timeIntervalSince1970 * 1000))
    }
    func getSnapshot(in context: Context, completion: @escaping (PingEntry) -> Void) {
        completion(PingEntry(date: .now, snapshot: .load()))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<PingEntry>) -> Void) {
        let entry = PingEntry(date: .now, snapshot: .load())
        completion(Timeline(entries: [entry], policy: .after(.now.addingTimeInterval(15 * 60))))
    }
}

struct PingWidgetView: View {
    let entry: PingEntry
    private var current: PingSnapshot.Current? { entry.snapshot.current }
    private var riskColor: Color {
        let score = current?.riskValue ?? 0
        if score <= 25 { return Color(red: 0.42, green: 0.60, blue: 0.32) }
        if score <= 50 { return Color(red: 0.72, green: 0.57, blue: 0.22) }
        return Color(red: 0.76, green: 0.35, blue: 0.28)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 7) {
                Image(systemName: "dot.radiowaves.left.and.right")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Color(red: 0.34, green: 0.50, blue: 0.28))
                Text("PING OBSERVER").font(.system(size: 9, weight: .bold, design: .monospaced)).tracking(1.2)
                Spacer()
                Text("2.0").font(.system(size: 9, design: .monospaced)).foregroundStyle(.secondary)
            }
            Spacer(minLength: 13)
            HStack(alignment: .top, spacing: 0) {
                metric(title: "IP 位置", value: current?.location ?? "等待检测", symbol: "location.fill", color: Color(red: 0.34, green: 0.50, blue: 0.28))
                Spacer(minLength: 12)
                metric(title: "风控参考值", value: current?.riskValue.map { "\($0)/100" } ?? "—", subtitle: current?.riskLabel, symbol: "shield.lefthalf.filled", color: riskColor)
                Spacer(minLength: 12)
                metric(title: "估算共享人数", value: current?.sharedUsers ?? "—", symbol: "person.2.fill", color: Color(red: 0.43, green: 0.52, blue: 0.39))
            }
            Spacer(minLength: 9)
            HStack {
                Text("数据来自 ping0.cc").font(.system(size: 8)).foregroundStyle(.secondary)
                Spacer()
                if let timestamp = current?.checkedAt {
                    Text(Date(timeIntervalSince1970: timestamp / 1000), style: .time)
                        .font(.system(size: 8, design: .monospaced)).foregroundStyle(.secondary)
                } else { Text("尚无更新").font(.system(size: 8)).foregroundStyle(.secondary) }
            }
        }
        .padding(16)
        .containerBackground(Color(red: 0.96, green: 0.97, blue: 0.93), for: .widget)
    }

    @ViewBuilder private func metric(title: String, value: String, subtitle: String? = nil, symbol: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Label(title, systemImage: symbol).font(.system(size: 9, weight: .medium)).foregroundStyle(.secondary).lineLimit(1)
            Text(value).font(.system(size: 15, weight: .semibold, design: .rounded)).foregroundStyle(color).lineLimit(2).minimumScaleFactor(0.72)
            if let subtitle, !subtitle.isEmpty {
                Text(subtitle).font(.system(size: 8)).foregroundStyle(.secondary).lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

@main
struct PingObserverWidget: Widget {
    let kind = "PingObserverMediumWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: PingProvider()) { entry in
            PingWidgetView(entry: entry)
        }
        .configurationDisplayName("Ping Observer")
        .description("查看 IP 位置、风控参考值和估算共享人数。")
        .supportedFamilies([.systemMedium])
    }
}
