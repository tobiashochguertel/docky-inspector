// geticon.swift — resolve icons the way Docky does (LaunchServices).
// Single icon:
//   geticon <bundle-id> <output-png> [pixel-size]
// Folder-style 2x2 mosaic of up to 4 apps:
//   geticon --mosaic <output-png> [pixel-size] <bundle-id>...
// Exit codes: 0 ok, 1 app/icon not found, 2 render failed, 3 bad args.

import AppKit
import Foundation

func fail(_ code: Int32, _ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(code)
}

func iconImage(for bundleID: String) -> NSImage? {
    guard let appURL = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleID) else {
        return nil
    }
    return NSWorkspace.shared.icon(forFile: appURL.path)
}

func writePNG(_ image: NSImage, side: Int, to outPath: String) {
    guard let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: side,
        pixelsHigh: side,
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
    image.draw(
        in: NSRect(x: 0, y: 0, width: side, height: side),
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
}

func drawMosaic(_ bundleIDs: [String], side: Int, to outPath: String) {
    let canvas = NSImage(size: NSSize(width: side, height: side))
    canvas.lockFocus()
    NSColor.clear.set()
    NSRect(x: 0, y: 0, width: side, height: side).fill()
    let gap = CGFloat(side) * 0.06
    let cell = (CGFloat(side) - gap * 3) / 2
    for (index, bid) in bundleIDs.prefix(4).enumerated() {
        let col = index % 2
        let row = index / 2
        let rect = NSRect(
            x: gap + CGFloat(col) * (cell + gap),
            y: gap + CGFloat(1 - row) * (cell + gap),
            width: cell,
            height: cell
        )
        if let icon = iconImage(for: bid) {
            icon.draw(in: rect, from: NSRect.zero, operation: .sourceOver, fraction: 1.0)
        } else {
            // Unresolvable app: light placeholder like Docky's grid shows.
            NSColor(white: 0.85, alpha: 1.0).setFill()
            NSBezierPath(roundedRect: rect, xRadius: cell * 0.22, yRadius: cell * 0.22).fill()
        }
    }
    canvas.unlockFocus()
    writePNG(canvas, side: side, to: outPath)
}

let args = CommandLine.arguments
guard args.count >= 3 else { fail(3, "usage: geticon [--mosaic] <output-png> ...") }

if args[1] == "--mosaic" {
    guard args.count >= 4 else { fail(3, "usage: geticon --mosaic <output-png> [pixel-size] <bundle-id>...") }
    var rest = Array(args.dropFirst(2))
    var pixels = 256
    if let first = rest.first, let n = Int(first), rest.count > 1 {
        pixels = n
        rest = Array(rest.dropFirst())
    }
    guard pixels > 0, pixels <= 1024, !rest.isEmpty else { fail(3, "need pixel-size and at least one bundle id") }
    drawMosaic(rest, side: pixels, to: args[2])
    exit(0)
}

let bundleID = args[1]
let outPath = args[2]
let pixels = args.count >= 4 ? Int(args[3]) ?? 256 : 256
guard pixels > 0, pixels <= 1024 else { fail(3, "pixel-size must be 1...1024") }

guard let icon = iconImage(for: bundleID) else {
    fail(1, "no application for bundle id \(bundleID)")
}
writePNG(icon, side: pixels, to: outPath)
