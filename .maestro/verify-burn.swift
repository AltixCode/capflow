// Verifies the captioned video CapFlow wrote to the camera roll.
//
// Usage: verify-burn <source.mov> <exported.mp4>
//
// This reads the exported file from outside the app, because every previous
// defect in this suite survived a green UI run: the flow tapped the right
// buttons, the app said "Saved!", and the file was wrong. A burn can fail by
// producing no captions, captions that never go away, captions over the wrong
// part of the frame, a video that was quietly rescaled or rotated, or one whose
// audio was dropped -- and all of those export successfully.

import AVFoundation
import CoreGraphics
import Foundation

struct Failure: Error { let message: String }

let arguments = CommandLine.arguments
guard arguments.count == 3 else {
  FileHandle.standardError.write(Data("usage: verify-burn <source> <exported>\n".utf8))
  exit(2)
}
let sourceURL = URL(fileURLWithPath: arguments[1])
let exportURL = URL(fileURLWithPath: arguments[2])

/// The band the layout puts captions in: the block's bottom edge sits at 80% of
/// height, and the tallest block reaches up to about 62%.
let bandTop = 0.60
let bandBottom = 0.82
/// Luma difference that counts as a changed pixel. Re-encoding moves every
/// pixel a little, so a tighter threshold would call compression noise a
/// caption.
let lumaThreshold = 48

func presentedSize(_ asset: AVURLAsset) async throws -> CGSize {
  guard let track = try await asset.loadTracks(withMediaType: .video).first else {
    throw Failure(message: "no video track")
  }
  let size = try await track.load(.naturalSize)
  let transform = try await track.load(.preferredTransform)
  let applied = size.applying(transform)
  return CGSize(width: abs(applied.width), height: abs(applied.height))
}

func generator(_ asset: AVURLAsset, size: CGSize) -> AVAssetImageGenerator {
  let generator = AVAssetImageGenerator(asset: asset)
  generator.appliesPreferredTrackTransform = true
  generator.requestedTimeToleranceBefore = .zero
  generator.requestedTimeToleranceAfter = .zero
  generator.maximumSize = size
  return generator
}

/// 8-bit luma of one frame, row-major, at the given size.
func luma(_ image: CGImage, width: Int, height: Int) -> [UInt8] {
  var pixels = [UInt8](repeating: 0, count: width * height)
  pixels.withUnsafeMutableBytes { buffer in
    let context = CGContext(
      data: buffer.baseAddress,
      width: width,
      height: height,
      bitsPerComponent: 8,
      bytesPerRow: width,
      space: CGColorSpaceCreateDeviceGray(),
      bitmapInfo: CGImageAlphaInfo.none.rawValue
    )
    context?.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
  }
  return pixels
}

/// Fraction of pixels in [rowStart, rowEnd) that differ between two frames.
func changedFraction(_ a: [UInt8], _ b: [UInt8], width: Int, rowStart: Int, rowEnd: Int) -> Double {
  var changed = 0
  var total = 0
  for row in rowStart..<rowEnd {
    for column in 0..<width {
      let index = row * width + column
      if abs(Int(a[index]) - Int(b[index])) > lumaThreshold { changed += 1 }
      total += 1
    }
  }
  return total == 0 ? 0 : Double(changed) / Double(total)
}

let done = DispatchSemaphore(value: 0)
var failures: [String] = []
var notes: [String] = []

Task {
  do {
    let source = AVURLAsset(url: sourceURL)
    let export = AVURLAsset(url: exportURL)

    let sourceSize = try await presentedSize(source)
    let exportSize = try await presentedSize(export)
    if sourceSize != exportSize {
      failures.append("size changed: \(Int(sourceSize.width))x\(Int(sourceSize.height)) -> \(Int(exportSize.width))x\(Int(exportSize.height))")
    }

    let sourceSeconds = CMTimeGetSeconds(try await source.load(.duration))
    let exportSeconds = CMTimeGetSeconds(try await export.load(.duration))
    if abs(sourceSeconds - exportSeconds) > 0.3 {
      failures.append(String(format: "duration changed: %.2fs -> %.2fs", sourceSeconds, exportSeconds))
    }

    if try await export.loadTracks(withMediaType: .audio).isEmpty {
      failures.append("the export has no audio track")
    }

    // Sampled small: the comparison is per pixel, and the caption either
    // covers a visible share of the band at this scale or it is too small to
    // read on a phone anyway.
    let width = 216
    let height = Int((Double(width) * sourceSize.height / sourceSize.width).rounded())
    let scaled = CGSize(width: width, height: height)
    let sourceFrames = generator(source, size: scaled)
    let exportFrames = generator(export, size: scaled)

    let bandStart = Int(Double(height) * bandTop)
    let bandEnd = Int(Double(height) * bandBottom)

    var inkByTime: [(Double, Double)] = []
    var outsideWorst = 0.0
    var time = 0.05
    while time < min(sourceSeconds, exportSeconds) - 0.05 {
      let at = CMTime(seconds: time, preferredTimescale: 600)
      let a = luma(try sourceFrames.copyCGImage(at: at, actualTime: nil), width: width, height: height)
      let b = luma(try exportFrames.copyCGImage(at: at, actualTime: nil), width: width, height: height)
      inkByTime.append((time, changedFraction(a, b, width: width, rowStart: bandStart, rowEnd: bandEnd)))
      // Everything above the caption band has to survive the burn untouched.
      outsideWorst = max(outsideWorst, changedFraction(a, b, width: width, rowStart: 0, rowEnd: bandStart))
      time += 0.1
    }

    guard !inkByTime.isEmpty else {
      throw Failure(message: "could not sample any frames")
    }

    let peak = inkByTime.map(\.1).max() ?? 0
    if peak < 0.01 {
      failures.append(String(format: "no captions were burned in (peak change in the caption band %.3f%%)", peak * 100))
    }

    // The fixture ends with half a second of silence, so the last frames must
    // carry no caption. A caption still up here means the cue end times were
    // ignored, which on a real clip leaves the last words frozen on screen.
    let tail = inkByTime.filter { $0.0 > min(sourceSeconds, exportSeconds) - 0.3 }
    if let worstTail = tail.map(\.1).max(), worstTail > 0.01 {
      failures.append(String(format: "a caption is still on screen after the speech ends (%.2f%% at the tail)", worstTail * 100))
    }

    if outsideWorst > 0.02 {
      failures.append(String(format: "the video outside the caption band changed (%.2f%%): it was rescaled, shifted or re-rendered", outsideWorst * 100))
    }

    notes.append(String(format: "%dx%d, %.2fs, peak caption coverage %.1f%%, frame drift %.2f%%",
                        Int(exportSize.width), Int(exportSize.height), exportSeconds, peak * 100, outsideWorst * 100))
  } catch let failure as Failure {
    failures.append(failure.message)
  } catch {
    failures.append(error.localizedDescription)
  }
  done.signal()
}
done.wait()

for note in notes { print("  \(note)") }
if failures.isEmpty {
  print("PASS \(exportURL.lastPathComponent)")
  exit(0)
}
for failure in failures { print("FAIL \(failure)") }
exit(1)
