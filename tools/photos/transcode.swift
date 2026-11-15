// Transcodes one exercise clip into the single rendition the API serves (AMENDED_PLAN_NOTES §7): H.264 High, the
// source's 1280×720, about 2 Mbps, network-optimised (index before the media data), no audio, with the light grade
// CIColorControls saturation 0.80 and contrast 1.05. AVFoundation and Core Image only (no ffmpeg on this Mac).
//
//     swiftc -O tools/photos/transcode.swift -o <scratch>/transcode    (or: swift tools/photos/transcode.swift …)
//     <scratch>/transcode IN.mp4 OUT.mp4 [--start SECONDS] [--end SECONDS] [--bitrate BITS_PER_SECOND]
//
// --start and --end keep only that stretch of the clip (one whose opening or ending fails the review); the output then
// starts at 0.
// Prints "OUT.mp4 <width>x<height> <seconds> s <bytes> bytes".
import AVFoundation
import CoreImage
import Foundation

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data("transcode: \(message)\n".utf8))
    exit(1)
}

func number(_ text: String?, _ what: String) -> Double {
    guard let text, let value = Double(text) else { fail(what) }
    return value
}

var positional: [String] = []
var startSeconds = 0.0
var endSeconds: Double?
var bitrate = 2_000_000
var argv = CommandLine.arguments.dropFirst().makeIterator()
while let arg = argv.next() {
    switch arg {
    case "--start": startSeconds = number(argv.next(), "--start needs seconds")
    case "--end": endSeconds = number(argv.next(), "--end needs seconds")
    case "--bitrate": bitrate = Int(number(argv.next(), "--bitrate needs bits per second"))
    default: positional.append(arg)
    }
}
guard positional.count == 2 else { fail("usage: transcode IN.mp4 OUT.mp4 [--start SECONDS] [--end SECONDS] [--bitrate BPS]") }
let inURL = URL(fileURLWithPath: positional[0])
let outURL = URL(fileURLWithPath: positional[1])
try? FileManager.default.removeItem(at: outURL)

let asset = AVURLAsset(url: inURL)
guard let track = try await asset.loadTracks(withMediaType: .video).first else { fail("\(inURL.lastPathComponent) has no video track") }
let duration = try await asset.load(.duration)
let (naturalSize, transform, frameRate) = try await track.load(.naturalSize, .preferredTransform, .nominalFrameRate)
let start = CMTime(seconds: startSeconds, preferredTimescale: 600)
let end = endSeconds.map { min(CMTime(seconds: $0, preferredTimescale: 600), duration) } ?? duration
guard start < end else { fail("nothing left between --start and --end") }

// The grade, applied to every frame as it is read
let composition = try await AVMutableVideoComposition.videoComposition(with: asset) { request in
    let source = request.sourceImage
    guard let filter = CIFilter(name: "CIColorControls") else { return request.finish(with: source, context: nil) }
    filter.setValue(source.clampedToExtent(), forKey: kCIInputImageKey)
    filter.setValue(0.80, forKey: kCIInputSaturationKey)
    filter.setValue(1.05, forKey: kCIInputContrastKey)
    filter.setValue(0.0, forKey: kCIInputBrightnessKey)
    request.finish(with: (filter.outputImage ?? source).cropped(to: source.extent), context: nil)
}

let reader = try AVAssetReader(asset: asset)
reader.timeRange = CMTimeRange(start: start, end: end)
let output = AVAssetReaderVideoCompositionOutput(videoTracks: [track], videoSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
output.videoComposition = composition
guard reader.canAdd(output) else { fail("cannot read \(inURL.lastPathComponent)") }
reader.add(output)

let width = Int(naturalSize.width.rounded()), height = Int(naturalSize.height.rounded())
let writer = try AVAssetWriter(outputURL: outURL, fileType: .mp4)
writer.shouldOptimizeForNetworkUse = true
let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
    AVVideoCodecKey: AVVideoCodecType.h264,
    AVVideoWidthKey: width,
    AVVideoHeightKey: height,
    AVVideoColorPropertiesKey: [
        AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2,
        AVVideoTransferFunctionKey: AVVideoTransferFunction_ITU_R_709_2,
        AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2,
    ],
    AVVideoCompressionPropertiesKey: [
        AVVideoAverageBitRateKey: bitrate,
        AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
        AVVideoH264EntropyModeKey: AVVideoH264EntropyModeCABAC,
        AVVideoExpectedSourceFrameRateKey: Int(frameRate.rounded()),
        AVVideoMaxKeyFrameIntervalKey: Int(frameRate.rounded()) * 2,
        AVVideoAllowFrameReorderingKey: true,
    ],
])
input.transform = transform
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: nil)
guard writer.canAdd(input) else { fail("cannot write \(outURL.lastPathComponent)") }
writer.add(input)

guard writer.startWriting() else { fail(writer.error?.localizedDescription ?? "writer did not start") }
guard reader.startReading() else { fail(reader.error?.localizedDescription ?? "reader did not start") }
writer.startSession(atSourceTime: .zero)

// Frames are re-timed from the trim point, so the file starts at 0. The block runs until the reader is drained; it
// resumes the continuation exactly once (AVFoundation stops calling it after markAsFinished).
let appendError: String? = await withCheckedContinuation { done in
    input.requestMediaDataWhenReady(on: DispatchQueue(label: "transcode")) {
        while input.isReadyForMoreMediaData {
            guard let sample = output.copyNextSampleBuffer() else {
                input.markAsFinished()
                return done.resume(returning: nil)
            }
            guard let pixels = CMSampleBufferGetImageBuffer(sample) else { continue }
            let time = CMTimeSubtract(CMSampleBufferGetPresentationTimeStamp(sample), start)
            if !adaptor.append(pixels, withPresentationTime: time) {
                reader.cancelReading()
                input.markAsFinished()
                return done.resume(returning: writer.error?.localizedDescription ?? "a frame could not be written")
            }
        }
    }
}
if let appendError { fail(appendError) }
if reader.status == .failed { fail(reader.error?.localizedDescription ?? "reading failed") }
await writer.finishWriting()
guard writer.status == .completed else { fail(writer.error?.localizedDescription ?? "writing failed") }

let written = AVURLAsset(url: outURL)
let seconds = try await written.load(.duration).seconds
let bytes = (try? FileManager.default.attributesOfItem(atPath: outURL.path)[.size] as? Int) ?? 0
print("\(outURL.path) \(width)x\(height) \(String(format: "%.3f", seconds)) s \(bytes) bytes")
