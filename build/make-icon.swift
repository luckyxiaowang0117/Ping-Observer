import AppKit
import Foundation
let side = 1024
let image = NSImage(size: NSSize(width: side, height: side))
image.lockFocus()
let bounds = NSRect(x: 24, y: 24, width: 976, height: 976)
NSColor(calibratedRed: 0.09, green: 0.19, blue: 0.15, alpha: 1).setFill()
NSBezierPath(roundedRect: bounds, xRadius: 220, yRadius: 220).fill()
let center = NSPoint(x: 512, y: 512)
NSColor(calibratedRed: 0.73, green: 0.95, blue: 0.43, alpha: 1).setStroke()
for radius in [278.0, 206.0] {
    let circle = NSBezierPath(ovalIn: NSRect(x: center.x-radius, y: center.y-radius, width: radius*2, height: radius*2))
    circle.lineWidth = 28
    circle.stroke()
}
NSColor(calibratedRed: 0.73, green: 0.95, blue: 0.43, alpha: 1).setFill()
NSBezierPath(ovalIn: NSRect(x: center.x-54, y: center.y-54, width: 108, height: 108)).fill()
image.unlockFocus()
guard let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff), let png = rep.representation(using: .png, properties: [:]) else { fatalError("Could not render icon") }
try png.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
