import ExpoModulesCore
import AVFoundation
import UIKit

/// Extracts transcribable audio and burns captions into video with AVFoundation.
///
/// The spec asked for FFmpeg and libass. ffmpeg-kit's binaries were withdrawn
/// in 2025 and neither the CocoaPods podspec nor the Maven artifacts resolve,
/// so this uses the frameworks FFmpeg's own iOS backend sits on top of:
/// AVAssetReader and AVAssetWriter, compositing each frame with Core Image.
///
/// The obvious route for burned-in captions is
/// AVVideoCompositionCoreAnimationTool, which renders a CALayer tree into the
/// video. It is not used here because it cannot render in the simulator: its
/// compositor traps inside IOSurfaceCreate, so the export crashes rather than
/// failing. An export path that can only be exercised on physical hardware
/// cannot be gated in CI, and this suite has been bitten repeatedly by things
/// that were only ever checked by eye. Reading and writing the frames directly
/// also gives real progress and keeps the audio as compressed passthrough.
public class CaptionBurnerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("CaptionBurner")

    // Burning captions re-encodes the video, which on a minute of 4K is tens
    // of seconds. A spinner with no number reads as a hang.
    Events("onBurnProgress")

    AsyncFunction("getInfo") { (uri: String, promise: Promise) in
      Task {
        do {
          let asset = AVURLAsset(url: Self.url(uri))
          let duration = try await asset.load(.duration)
          guard let track = try await asset.loadTracks(withMediaType: .video).first else {
            promise.reject("ERR_CAPTION", "The file contains no video track.")
            return
          }
          // naturalSize ignores rotation. A portrait iPhone clip is stored
          // 1920x1080 with a quarter-turn transform, and laying captions out
          // against the stored size puts every one of them off-screen.
          let size = try await track.load(.naturalSize)
          let transform = try await track.load(.preferredTransform)
          let presented = size.applying(transform)
          promise.resolve([
            "duration": CMTimeGetSeconds(duration),
            "width": Int(abs(presented.width).rounded()),
            "height": Int(abs(presented.height).rounded()),
          ])
        } catch {
          promise.reject("ERR_CAPTION", error.localizedDescription)
        }
      }
    }

    AsyncFunction("extractAudio") { (uri: String, promise: Promise) in
      Task {
        do {
          let output = try await Self.extractWav(from: Self.url(uri))
          promise.resolve(["uri": output.absoluteString, "sampleRate": Self.whisperSampleRate])
        } catch let error as BurnerError {
          promise.reject("ERR_CAPTION", error.message)
        } catch {
          promise.reject("ERR_CAPTION", error.localizedDescription)
        }
      }
    }

    AsyncFunction("burn") { (uri: String, plan: String, promise: Promise) in
      Task { [weak self] in
        do {
          let output = try await Self.burn(url: Self.url(uri), planJSON: plan) { fraction in
            self?.sendEvent("onBurnProgress", ["progress": fraction])
          }
          promise.resolve(["uri": output.absoluteString])
        } catch let error as BurnerError {
          promise.reject("ERR_CAPTION", error.message)
        } catch {
          promise.reject("ERR_CAPTION", error.localizedDescription)
        }
      }
    }
  }

  // MARK: - Audio

  /// whisper only accepts 16 kHz mono, so there is nothing to configure here.
  private static let whisperSampleRate = 16_000

  private static func extractWav(from url: URL) async throws -> URL {
    let asset = AVURLAsset(url: url)
    guard let track = try await asset.loadTracks(withMediaType: .audio).first else {
      throw BurnerError("This video has no audio to transcribe.")
    }

    let reader = try AVAssetReader(asset: asset)
    // AVAssetReaderAudioMixOutput resamples and downmixes on the way out, so
    // whatever the camera recorded arrives as the one format whisper reads.
    let output = AVAssetReaderAudioMixOutput(
      audioTracks: [track],
      audioSettings: [
        AVFormatIDKey: kAudioFormatLinearPCM,
        AVSampleRateKey: whisperSampleRate,
        AVNumberOfChannelsKey: 1,
        AVLinearPCMBitDepthKey: 16,
        AVLinearPCMIsFloatKey: false,
        AVLinearPCMIsBigEndianKey: false,
        AVLinearPCMIsNonInterleaved: false,
      ]
    )
    guard reader.canAdd(output) else {
      throw BurnerError("This audio track cannot be decoded on this device.")
    }
    reader.add(output)

    let destination = FileManager.default.temporaryDirectory
      .appendingPathComponent("capflow_\(Int(Date().timeIntervalSince1970 * 1000)).wav")
    FileManager.default.createFile(atPath: destination.path, contents: nil)
    guard let handle = try? FileHandle(forWritingTo: destination) else {
      throw BurnerError("Could not write the audio file.")
    }
    defer { try? handle.close() }

    // Length is unknown until the read finishes, so the header goes down with
    // zeroed sizes and is patched in place afterwards.
    handle.write(wavHeader(dataBytes: 0))

    guard reader.startReading() else {
      throw BurnerError(reader.error?.localizedDescription ?? "The audio could not be read.")
    }

    var written = 0
    while let sample = output.copyNextSampleBuffer() {
      guard let block = CMSampleBufferGetDataBuffer(sample) else { continue }
      let length = CMBlockBufferGetDataLength(block)
      var bytes = [UInt8](repeating: 0, count: length)
      let status = CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: length, destination: &bytes)
      if status == kCMBlockBufferNoErr {
        handle.write(Data(bytes))
        written += length
      }
    }

    if reader.status == .failed {
      throw BurnerError(reader.error?.localizedDescription ?? "The audio could not be decoded.")
    }
    guard written > 0 else {
      throw BurnerError("This video has no audio to transcribe.")
    }

    try handle.seek(toOffset: 0)
    handle.write(wavHeader(dataBytes: written))
    return destination
  }

  /// A 44-byte canonical WAV header. whisper.rn reads the file itself, so it
  /// has to be a real container rather than raw samples.
  private static func wavHeader(dataBytes: Int) -> Data {
    let channels = 1
    let bits = 16
    let byteRate = whisperSampleRate * channels * bits / 8
    var data = Data()
    func ascii(_ s: String) { data.append(contentsOf: Array(s.utf8)) }
    func u32(_ v: Int) { var le = UInt32(truncatingIfNeeded: v).littleEndian; withUnsafeBytes(of: &le) { data.append(contentsOf: $0) } }
    func u16(_ v: Int) { var le = UInt16(truncatingIfNeeded: v).littleEndian; withUnsafeBytes(of: &le) { data.append(contentsOf: $0) } }

    ascii("RIFF"); u32(36 + dataBytes); ascii("WAVE")
    ascii("fmt "); u32(16); u16(1); u16(channels)
    u32(whisperSampleRate); u32(byteRate); u16(channels * bits / 8); u16(bits)
    ascii("data"); u32(dataBytes)
    return data
  }

  // MARK: - Burn-in

  private static func burn(
    url: URL,
    planJSON: String,
    onProgress: @escaping (Double) -> Void
  ) async throws -> URL {
    guard
      let data = planJSON.data(using: .utf8),
      let raw = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let plan = BurnPlan(raw)
    else {
      throw BurnerError("The caption layout could not be read.")
    }

    let asset = AVURLAsset(url: url)
    guard let videoTrack = try await asset.loadTracks(withMediaType: .video).first else {
      throw BurnerError("The file contains no video track.")
    }

    // Built from the asset's own properties, so rotation, frame rate and render
    // size come from the source rather than being assumed. Reading through a
    // video composition is also what applies the camera's rotation: the frames
    // arrive the way the video presents, which is the space the captions were
    // laid out in.
    let videoComposition = try await AVMutableVideoComposition.videoComposition(withPropertiesOf: asset)
    let renderSize = videoComposition.renderSize
    guard renderSize.width > 0, renderSize.height > 0 else {
      throw BurnerError("This video's dimensions could not be read.")
    }

    // The plan is laid out against the size the app measured. If that differs
    // from the render size -- a video whose metadata the picker rounded, say --
    // scaling here keeps the export matching the preview instead of placing
    // captions by coincidence.
    let scale = renderSize.width / max(plan.videoWidth, 1)

    let reader = try AVAssetReader(asset: asset)
    let videoOutput = AVAssetReaderVideoCompositionOutput(
      videoTracks: [videoTrack],
      videoSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
    )
    videoOutput.videoComposition = videoComposition
    videoOutput.alwaysCopiesSampleData = false
    guard reader.canAdd(videoOutput) else {
      throw BurnerError("This video cannot be decoded on this device.")
    }
    reader.add(videoOutput)

    // Audio is untouched by captioning, so it is copied as compressed samples
    // rather than decoded and re-encoded.
    let audioTrack = try await asset.loadTracks(withMediaType: .audio).first
    var audioOutput: AVAssetReaderTrackOutput?
    if let audioTrack {
      let output = AVAssetReaderTrackOutput(track: audioTrack, outputSettings: nil)
      output.alwaysCopiesSampleData = false
      if reader.canAdd(output) {
        reader.add(output)
        audioOutput = output
      }
    }

    let destination = FileManager.default.temporaryDirectory
      .appendingPathComponent("capflow_\(Int(Date().timeIntervalSince1970 * 1000)).mp4")
    let writer = try AVAssetWriter(outputURL: destination, fileType: .mp4)

    let frameRate = videoComposition.frameDuration.timescale > 0
      ? Double(videoComposition.frameDuration.timescale) / Double(max(videoComposition.frameDuration.value, 1))
      : 30
    let videoInput = AVAssetWriterInput(
      mediaType: .video,
      outputSettings: [
        AVVideoCodecKey: AVVideoCodecType.h264,
        AVVideoWidthKey: Int(renderSize.width),
        AVVideoHeightKey: Int(renderSize.height),
        AVVideoCompressionPropertiesKey: [
          // Roughly four bits per pixel per second. Captions are the
          // highest-frequency thing in the frame and the first to smear when
          // the bitrate is too low.
          AVVideoAverageBitRateKey: min(Int(renderSize.width * renderSize.height * 4), 40_000_000),
          AVVideoMaxKeyFrameIntervalKey: Int(frameRate.rounded()),
        ],
      ]
    )
    videoInput.expectsMediaDataInRealTime = false
    // The frames are already in display orientation, so no transform is
    // carried over; setting one as well would rotate them twice.
    videoInput.transform = .identity
    writer.add(videoInput)

    let adaptor = AVAssetWriterInputPixelBufferAdaptor(
      assetWriterInput: videoInput,
      sourcePixelBufferAttributes: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
        kCVPixelBufferWidthKey as String: Int(renderSize.width),
        kCVPixelBufferHeightKey as String: Int(renderSize.height),
      ]
    )

    var audioInput: AVAssetWriterInput?
    if let audioTrack, audioOutput != nil {
      let formats = try await audioTrack.load(.formatDescriptions)
      let input = AVAssetWriterInput(mediaType: .audio, outputSettings: nil, sourceFormatHint: formats.first)
      input.expectsMediaDataInRealTime = false
      if writer.canAdd(input) {
        writer.add(input)
        audioInput = input
      }
    }

    guard reader.startReading() else {
      throw BurnerError(reader.error?.localizedDescription ?? "The video could not be read.")
    }
    guard writer.startWriting() else {
      throw BurnerError(writer.error?.localizedDescription ?? "The export could not be started.")
    }
    writer.startSession(atSourceTime: .zero)

    let context = CIContext()
    let totalSeconds = CMTimeGetSeconds(try await asset.load(.duration))
    var currentBox = -2
    var captionImage: CIImage?

    try await withThrowingTaskGroup(of: Void.self) { group in
      group.addTask {
        await withCheckedContinuation { continuation in
          let queue = DispatchQueue(label: "capflow.burn.video")
          videoInput.requestMediaDataWhenReady(on: queue) {
            while videoInput.isReadyForMoreMediaData {
              guard let sample = videoOutput.copyNextSampleBuffer() else {
                videoInput.markAsFinished()
                continuation.resume()
                return
              }
              guard let source = CMSampleBufferGetImageBuffer(sample) else { continue }
              let time = CMSampleBufferGetPresentationTimeStamp(sample)
              let seconds = CMTimeGetSeconds(time)

              let index = plan.index(atSeconds: seconds)
              if index != currentBox {
                captionImage = index >= 0
                  ? Self.captionImage(for: plan.boxes[index], style: plan.style, renderSize: renderSize, scale: scale)
                  : nil
                currentBox = index
              }

              var buffer: CVPixelBuffer?
              if let pool = adaptor.pixelBufferPool {
                CVPixelBufferPoolCreatePixelBuffer(nil, pool, &buffer)
              }
              guard let destinationBuffer = buffer else { continue }

              let frame = CIImage(cvPixelBuffer: source)
              let composited = captionImage?.composited(over: frame) ?? frame
              context.render(composited, to: destinationBuffer)
              adaptor.append(destinationBuffer, withPresentationTime: time)

              if totalSeconds > 0 {
                onProgress(min(0.99, max(0, seconds / totalSeconds)))
              }
            }
          }
        }
      }

      if let audioInput, let audioOutput {
        group.addTask {
          await withCheckedContinuation { continuation in
            let queue = DispatchQueue(label: "capflow.burn.audio")
            audioInput.requestMediaDataWhenReady(on: queue) {
              while audioInput.isReadyForMoreMediaData {
                guard let sample = audioOutput.copyNextSampleBuffer() else {
                  audioInput.markAsFinished()
                  continuation.resume()
                  return
                }
                audioInput.append(sample)
              }
            }
          }
        }
      }

      try await group.waitForAll()
    }

    await writer.finishWriting()

    if reader.status == .failed {
      throw BurnerError(reader.error?.localizedDescription ?? "The video could not be decoded.")
    }
    guard writer.status == .completed else {
      throw BurnerError(writer.error?.localizedDescription ?? "The export failed.")
    }
    onProgress(1)
    return destination
  }

  /// One caption, drawn full-frame so compositing needs no geometry of its own.
  ///
  /// A full-frame image rather than a cropped one: the position then comes
  /// entirely from the layout, and there is no second place for it to be wrong.
  private static func captionImage(
    for box: CaptionBox,
    style: CaptionStyle,
    renderSize: CGSize,
    scale: CGFloat
  ) -> CIImage? {
    var fontSize = box.fontSize * scale
    let maxWidth = min(box.maxWidth * scale, renderSize.width)

    let font = UIFont.systemFont(ofSize: fontSize, weight: .heavy)
    // The layout picked the line breaks using an estimated glyph width. Here
    // the real font is available, so the size is nudged to fit -- but the line
    // breaks are kept. Re-wrapping would put a different number of lines on
    // screen than the preview the user approved.
    let widest = box.lines
      .map { ($0 as NSString).size(withAttributes: [.font: font]).width }
      .max() ?? 0
    if widest > maxWidth, widest > 0 {
      fontSize *= maxWidth / widest
    }

    let fitted = UIFont.systemFont(ofSize: fontSize, weight: .heavy)
    let fittedWidest = box.lines
      .map { ($0 as NSString).size(withAttributes: [.font: fitted]).width }
      .max() ?? 0
    let lineHeight = box.lineHeight * scale
    let blockTop = box.top * scale
    let blockHeight = lineHeight * CGFloat(box.lines.count)

    let paragraph = NSMutableParagraphStyle()
    paragraph.alignment = .center
    paragraph.lineSpacing = max(0, lineHeight - fitted.lineHeight)

    var attributes: [NSAttributedString.Key: Any] = [
      .font: fitted,
      .foregroundColor: color(style.color),
      .paragraphStyle: paragraph,
    ]
    if let stroke = style.strokeColor, !stroke.isEmpty, style.strokeRatio > 0 {
      attributes[.strokeColor] = color(stroke)
      // Negative means stroke *and* fill. A positive value draws the outline
      // only, which is invisible caption text on a dark video.
      attributes[.strokeWidth] = -style.strokeRatio * 100
    }

    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = false
    let renderer = UIGraphicsImageRenderer(size: renderSize, format: format)
    let image = renderer.image { _ in
      if let plateColor = style.plateColor, !plateColor.isEmpty {
        let padX = fontSize * 0.42
        let padY = fontSize * 0.22
        let plateWidth = min(renderSize.width, min(max(fittedWidest, 1), maxWidth) + padX * 2)
        let rect = CGRect(
          x: (renderSize.width - plateWidth) / 2,
          y: blockTop - padY,
          width: plateWidth,
          height: blockHeight + padY * 2
        )
        color(plateColor).setFill()
        UIBezierPath(roundedRect: rect, cornerRadius: fontSize * style.plateRadiusRatio).fill()
      }

      let text = NSAttributedString(string: box.lines.joined(separator: "\n"), attributes: attributes)
      text.draw(with: CGRect(x: 0, y: blockTop, width: renderSize.width, height: blockHeight),
                options: [.usesLineFragmentOrigin], context: nil)
    }

    guard let cgImage = image.cgImage else { return nil }
    return CIImage(cgImage: cgImage)
  }

  // MARK: - Plan decoding

  private struct CaptionStyle {
    let color: String
    let strokeColor: String?
    let strokeRatio: CGFloat
    let plateColor: String?
    let plateRadiusRatio: CGFloat

    init?(_ raw: [String: Any]) {
      guard let color = raw["color"] as? String else { return nil }
      self.color = color
      self.strokeColor = raw["strokeColor"] as? String
      self.strokeRatio = CGFloat(raw["strokeRatio"] as? Double ?? 0)
      self.plateColor = raw["plateColor"] as? String
      self.plateRadiusRatio = CGFloat(raw["plateRadiusRatio"] as? Double ?? 0)
    }
  }

  private struct CaptionBox {
    let lines: [String]
    let startMs: Int
    let endMs: Int
    let fontSize: CGFloat
    let lineHeight: CGFloat
    let top: CGFloat
    let width: CGFloat
    let maxWidth: CGFloat

    init?(_ raw: [String: Any]) {
      guard
        let lines = raw["lines"] as? [String],
        let startMs = raw["startMs"] as? Int,
        let endMs = raw["endMs"] as? Int,
        let fontSize = raw["fontSize"] as? Double,
        let lineHeight = raw["lineHeight"] as? Double,
        let top = raw["top"] as? Double,
        let width = raw["width"] as? Double,
        let maxWidth = raw["maxWidth"] as? Double,
        !lines.isEmpty
      else { return nil }
      self.lines = lines
      self.startMs = startMs
      self.endMs = endMs
      self.fontSize = CGFloat(fontSize)
      self.lineHeight = CGFloat(lineHeight)
      self.top = CGFloat(top)
      self.width = CGFloat(width)
      self.maxWidth = CGFloat(maxWidth)
    }
  }

  private struct BurnPlan {
    let videoWidth: CGFloat
    let style: CaptionStyle
    let boxes: [CaptionBox]

    /// Index of the caption visible at a time, or -1 between captions.
    func index(atSeconds seconds: Double) -> Int {
      let ms = Int((seconds * 1000).rounded())
      return boxes.firstIndex { ms >= $0.startMs && ms < $0.endMs } ?? -1
    }

    init?(_ raw: [String: Any]) {
      guard
        let video = raw["video"] as? [String: Any],
        let width = video["width"] as? Double,
        let styleRaw = raw["style"] as? [String: Any],
        let style = CaptionStyle(styleRaw),
        let boxesRaw = raw["boxes"] as? [[String: Any]]
      else { return nil }
      self.videoWidth = CGFloat(width)
      self.style = style
      // A box the layout could not describe is dropped rather than rendered
      // with defaults: a caption in the wrong place is worse than one missing
      // caption, and the count is verifiable from JS.
      self.boxes = boxesRaw.compactMap { CaptionBox($0) }
    }
  }

  // MARK: - Helpers

  /// #RRGGBB or #RRGGBBAA, which is what the style presets use.
  private static func color(_ hex: String) -> UIColor {
    var text = hex.trimmingCharacters(in: .whitespacesAndNewlines)
    if text.hasPrefix("#") { text.removeFirst() }
    guard text.count == 6 || text.count == 8, let value = UInt64(text, radix: 16) else {
      return .white
    }
    let hasAlpha = text.count == 8
    let r = CGFloat((value >> (hasAlpha ? 24 : 16)) & 0xFF) / 255
    let g = CGFloat((value >> (hasAlpha ? 16 : 8)) & 0xFF) / 255
    let b = CGFloat((value >> (hasAlpha ? 8 : 0)) & 0xFF) / 255
    let a = hasAlpha ? CGFloat(value & 0xFF) / 255 : 1
    return UIColor(red: r, green: g, blue: b, alpha: a)
  }

  private static func url(_ uri: String) -> URL {
    URL(string: uri) ?? URL(fileURLWithPath: uri)
  }

  private struct BurnerError: Error {
    let message: String
    init(_ message: String) { self.message = message }
  }
}
