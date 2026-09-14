package expo.modules.captionburner

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.media.MediaMuxer
import android.util.Log
import android.opengl.Matrix
import java.io.File
import java.nio.ByteBuffer

/**
 * Burns a caption plan into a video with MediaCodec.
 *
 * Frames are decoded to a texture, composited with the caption in GL and fed
 * straight to the encoder's input surface, so nothing round-trips through
 * software. The audio track is copied across as compressed samples rather than
 * re-encoded: it is untouched by captioning, and re-encoding it would cost
 * quality for no reason.
 *
 * The video's rotation metadata is carried over rather than baked in, so the
 * bitstream keeps the orientation the camera recorded. That means the caption
 * overlay is the thing that has to be rotated into the stored frame's space --
 * the alternative, re-orienting every frame, re-renders video the user did not
 * ask to change.
 */
internal object VideoBurner {

  private const val TAG = "CaptionBurner"

  class BurnFailure(message: String) : Exception(message)

  /** How long the encoder gets to flush after end of stream. */
  private const val DRAIN_TIMEOUT_MS = 30_000L

  fun burn(
    inputPath: String,
    planJson: String,
    outputFile: File,
    onProgress: (Double) -> Unit,
  ): File {
    val plan = CaptionPlan.parse(planJson) ?: throw BurnFailure("The caption layout could not be read.")

    val extractor = MediaExtractor()
    extractor.setDataSource(inputPath)

    val videoTrack = extractor.trackIndexFor("video/")
      ?: throw BurnFailure("The file contains no video track.")
    val audioTrack = extractor.trackIndexFor("audio/")

    val videoFormat = extractor.getTrackFormat(videoTrack)
    val codedWidth = videoFormat.getInteger(MediaFormat.KEY_WIDTH)
    val codedHeight = videoFormat.getInteger(MediaFormat.KEY_HEIGHT)

    val retriever = MediaMetadataRetriever()
    retriever.setDataSource(inputPath)
    val rotation = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
    val durationUs = (retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L) * 1000
    retriever.release()

    // Display size: the plan was laid out against what the video presents, not
    // how it is stored.
    val displayWidth = if (rotation == 90 || rotation == 270) codedHeight else codedWidth
    val displayHeight = if (rotation == 90 || rotation == 270) codedWidth else codedHeight
    val scale = if (plan.videoWidth > 0) displayWidth / plan.videoWidth else 1f

    val frameRate = if (videoFormat.containsKey(MediaFormat.KEY_FRAME_RATE)) {
      videoFormat.getInteger(MediaFormat.KEY_FRAME_RATE)
    } else 30

    val encoderFormat = MediaFormat.createVideoFormat("video/avc", codedWidth, codedHeight).apply {
      setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
      // Roughly 4 bits per pixel per second, which keeps text edges clean.
      // Captions are the highest-frequency thing in the frame and the first to
      // smear when the bitrate is too low.
      setInteger(MediaFormat.KEY_BIT_RATE, (codedWidth.toLong() * codedHeight * 4).coerceAtMost(40_000_000L).toInt())
      setInteger(MediaFormat.KEY_FRAME_RATE, frameRate)
      setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
    }

    val encoder = MediaCodec.createEncoderByType("video/avc")
    encoder.configure(encoderFormat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
    val pipeline = GlPipeline(encoder.createInputSurface())
    pipeline.setUp()
    encoder.start()

    val decoder = MediaCodec.createDecoderByType(videoFormat.getString(MediaFormat.KEY_MIME)!!)
    decoder.configure(videoFormat, pipeline.decoderSurface, null, 0)
    decoder.start()

    val muxer = MediaMuxer(outputFile.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
    muxer.setOrientationHint(rotation)

    val overlayRenderer = CaptionOverlayRenderer(displayWidth, displayHeight, plan.style, scale)
    val overlayMatrix = overlayMatrix(rotation)

    var muxerVideoTrack = -1
    var muxerAudioTrack = -1
    var muxerStarted = false
    var currentBox = -2
    var framesRendered = 0
    var drainDeadline = 0L

    extractor.selectTrack(videoTrack)
    val info = MediaCodec.BufferInfo()
    var inputDone = false
    var decoderDone = false
    var encoderDone = false

    try {
      while (!encoderDone) {
        if (!inputDone) {
          val index = decoder.dequeueInputBuffer(10_000)
          if (index >= 0) {
            val buffer = decoder.getInputBuffer(index)!!
            val size = extractor.readSampleData(buffer, 0)
            if (size < 0) {
              decoder.queueInputBuffer(index, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
              inputDone = true
            } else {
              decoder.queueInputBuffer(index, 0, size, extractor.sampleTime, 0)
              extractor.advance()
            }
          }
        }

        if (!decoderDone) {
          val index = decoder.dequeueOutputBuffer(info, 10_000)
          if (index >= 0) {
            val endOfStream = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
            // Not `info.size > 0`. A decoder writing to a Surface does not fill
            // a byte buffer, so it reports size 0 for perfectly good frames --
            // the emulator's decoder always does. Taking size as "is there a
            // frame" renders nothing, which leaves the encoder with no input,
            // which means it never reaches end of stream: the export sits at 0%
            // forever rather than failing.
            val render = !endOfStream
            val timeUs = info.presentationTimeUs
            decoder.releaseOutputBuffer(index, render)
            if (render) {
              if (!pipeline.awaitFrame()) {
                Log.e(TAG, "no frame arrived from the decoder after $framesRendered rendered frames")
                throw BurnFailure("The video could not be decoded on this device.")
              }
              val boxIndex = plan.indexAt(timeUs)
              if (boxIndex != currentBox) {
                pipeline.setOverlay(
                  if (boxIndex >= 0) overlayRenderer.render(plan.boxes[boxIndex]) else null
                )
                currentBox = boxIndex
              }
              pipeline.drawFrame(codedWidth, codedHeight, overlayMatrix)
              pipeline.present(timeUs * 1000)
              framesRendered++
              if (durationUs > 0) onProgress((timeUs.toDouble() / durationUs).coerceIn(0.0, 0.99))
            }
            if (endOfStream) {
              decoderDone = true
              Log.i(TAG, "decoder reached end of stream after $framesRendered rendered frames")
              if (framesRendered == 0) {
                throw BurnFailure("This video produced no frames to caption.")
              }
              encoder.signalEndOfInputStream()
              drainDeadline = System.currentTimeMillis() + DRAIN_TIMEOUT_MS
            }
          }
        }

        // Nothing downstream of end-of-stream is under our control, so the loop
        // gets a deadline rather than trusting the encoder to always finish.
        if (decoderDone && drainDeadline > 0 && System.currentTimeMillis() > drainDeadline) {
          throw BurnFailure("The encoder stopped responding.")
        }

        val index = encoder.dequeueOutputBuffer(info, 10_000)
        when {
          index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
            muxerVideoTrack = muxer.addTrack(encoder.outputFormat)
            // Every track has to be added before the muxer starts, so the
            // audio track is declared here rather than when its samples are
            // copied.
            if (audioTrack != null) {
              muxerAudioTrack = muxer.addTrack(extractor.getTrackFormat(audioTrack))
            }
            muxer.start()
            muxerStarted = true
          }
          index >= 0 -> {
            val buffer = encoder.getOutputBuffer(index)!!
            if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) info.size = 0
            if (info.size > 0 && muxerStarted) {
              buffer.position(info.offset)
              buffer.limit(info.offset + info.size)
              muxer.writeSampleData(muxerVideoTrack, buffer, info)
            }
            encoder.releaseOutputBuffer(index, false)
            if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) encoderDone = true
          }
        }
      }

      if (audioTrack != null && muxerStarted) {
        copyAudio(inputPath, audioTrack, muxer, muxerAudioTrack)
      }
      onProgress(1.0)
    } finally {
      runCatching { decoder.stop() }
      runCatching { decoder.release() }
      runCatching { encoder.stop() }
      runCatching { encoder.release() }
      pipeline.release()
      if (muxerStarted) runCatching { muxer.stop() }
      runCatching { muxer.release() }
      extractor.release()
    }

    if (!outputFile.exists() || outputFile.length() == 0L) {
      throw BurnFailure("The export produced no file.")
    }
    return outputFile
  }

  /**
   * Copies the compressed audio across untouched.
   *
   * A second extractor, because the video pass consumed the first one; seeking
   * the same extractor back would also reset the track selection mid-stream.
   */
  private fun copyAudio(path: String, track: Int, muxer: MediaMuxer, muxerTrack: Int) {
    val extractor = MediaExtractor()
    try {
      extractor.setDataSource(path)
      extractor.selectTrack(track)
      val format = extractor.getTrackFormat(track)
      val size = if (format.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE)) {
        format.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE)
      } else 256 * 1024
      val buffer = ByteBuffer.allocate(size)
      val info = MediaCodec.BufferInfo()
      while (true) {
        val read = extractor.readSampleData(buffer, 0)
        if (read < 0) break
        info.offset = 0
        info.size = read
        info.presentationTimeUs = extractor.sampleTime
        info.flags = extractor.sampleFlags
        muxer.writeSampleData(muxerTrack, buffer, info)
        extractor.advance()
      }
    } finally {
      extractor.release()
    }
  }

  /**
   * Rotates the caption overlay into the stored frame's space.
   *
   * The overlay is drawn in display space, which is where the plan laid it out.
   * The frames it is composited onto are in storage space, which for a phone
   * held upright is a quarter turn away.
   */
  private fun overlayMatrix(rotation: Int): FloatArray {
    val matrix = FloatArray(16)
    Matrix.setIdentityM(matrix, 0)
    Matrix.translateM(matrix, 0, 0.5f, 0.5f, 0f)
    Matrix.rotateM(matrix, 0, rotation.toFloat(), 0f, 0f, 1f)
    // The vertical flip belongs inside the rotation: GL's origin is bottom-left
    // and a bitmap's is top-left, and flipping afterwards would mirror the
    // caption on quarter turns.
    Matrix.scaleM(matrix, 0, 1f, -1f, 1f)
    Matrix.translateM(matrix, 0, -0.5f, -0.5f, 0f)
    return matrix
  }

  private fun MediaExtractor.trackIndexFor(prefix: String): Int? {
    for (index in 0 until trackCount) {
      val mime = getTrackFormat(index).getString(MediaFormat.KEY_MIME) ?: continue
      if (mime.startsWith(prefix)) return index
    }
    return null
  }
}
