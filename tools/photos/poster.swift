// Takes the poster of one transcoded exercise clip (AMENDED_PLAN_NOTES §7): the colour frame at 50 % of the clip,
// 960 px wide, JPEG quality 0.72, no metadata beyond what JPEG needs. AVFoundation and ImageIO only.
//
//     swiftc -O tools/photos/poster.swift -o <scratch>/poster    (or: swift tools/photos/poster.swift …)
//     <scratch>/poster CLIP.mp4 OUT.jpg [--at 0.5] [--width 960] [--quality 0.72]
//
// Prints "OUT.jpg <width>x<height> at <seconds> s".
import AVFoundation
import Foundation
import ImageIO
import UniformTypeIdentifiers

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data("poster: \(message)\n".utf8))
    exit(1)
}

func number(_ text: String?, _ what: String) -> Double {
    guard let text, let value = Double(text) else { fail(what) }
    return value
}

var positional: [String] = []
var at = 0.5
var width = 960.0
var quality = 0.72
var argv = CommandLine.arguments.dropFirst().makeIterator()
while let arg = argv.next() {
    switch arg {
    case "--at": at = number(argv.next(), "--at needs a fraction of the clip")
    case "--width": width = number(argv.next(), "--width needs pixels")
    case "--quality": quality = number(argv.next(), "--quality needs 0…1")
    default: positional.append(arg)
    }
}
guard positional.count == 2 else { fail("usage: poster CLIP.mp4 OUT.jpg [--at 0.5] [--width 960] [--quality 0.72]") }
let clipURL = URL(fileURLWithPath: positional[0])
let outURL = URL(fileURLWithPath: positional[1])

let asset = AVURLAsset(url: clipURL)
let duration = try await asset.load(.duration)
let generator = AVAssetImageGenerator(asset: asset)
generator.appliesPreferredTrackTransform = true
generator.requestedTimeToleranceBefore = .zero
generator.requestedTimeToleranceAfter = .zero
generator.maximumSize = CGSize(width: width, height: width)  // the long side of a landscape clip
let time = CMTime(seconds: duration.seconds * at, preferredTimescale: 600)
let (image, actual) = try await generator.image(at: time)

guard let destination = CGImageDestinationCreateWithURL(outURL as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else {
    fail("cannot write \(outURL.lastPathComponent)")
}
CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
guard CGImageDestinationFinalize(destination) else { fail("cannot finish \(outURL.lastPathComponent)") }
print("\(outURL.path) \(image.width)x\(image.height) at \(String(format: "%.3f", actual.seconds)) s")
