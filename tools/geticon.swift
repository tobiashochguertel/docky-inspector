// geticon.swift — resolve a bundle id to a PNG icon, exactly the way
// Docky does (LaunchServices, not bundle file layout). Usage:
//   geticon <bundle-id> <output-png> [pixel-size]
// Exit codes: 0 ok, 1 app not found, 2 render failed, 3 bad args.

import AppKit
import Foundation

func fail(_ code: Int32, _ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(code)
}

let args = CommandLine.arguments
guard args.count >= 3 else { fail(3, "usage: geticon <bundle-id> <output-png> [pixel-size]") }

let bundleID = args[1]
let outPath = args[2]
let pixels = args.count >= 4 ? Int(args[3]) ?? 256 : 256
guard pixels > 0, pixels <= 1024 else { fail(3, "pixel-size must be 1...1024") }

guard let appURL = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleID) else {
    fail(1, "no application for bundle id \(bundleID)")
}

let icon = NSWorkspace.shared.icon(forFile: appURL.path)
guard let rep = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: pixels,
    pixelsHigh: pixels,
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0,
    bitsPerPixel: 0
) else {
    fail(2, "could not allocate bitmap")
}

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
icon.draw(
    in: NSRect(x: 0, y: 0, width: pixels, height: pixels),
    from: NSRect.zero,
    operation: .copy,
    fraction: 1.0
)
NSGraphicsContext.restoreGraphicsState()

guard let png = rep.representation(using: .png, properties: [:]) else {
    fail(2, "could not encode png")
}
do {
    try png.write(to: URL(fileURLWithPath: outPath), options: .atomic)
} catch {
    fail(2, "could not write \(outPath): \(error)")
}
