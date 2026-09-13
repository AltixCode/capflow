package expo.modules.captionburner

import android.media.MediaMetadataRetriever
import android.net.Uri
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

/**
 * Extracts transcribable audio and burns captions into video.
 *
 * The spec asked for FFmpeg and libass. ffmpeg-kit's binaries were withdrawn in
 * 2025 and neither the Maven artifacts nor the CocoaPods podspec resolve, so
 * this uses the platform APIs FFmpeg's own Android backend sits on top of:
 * MediaExtractor and MediaCodec, with a GL pass for the overlay.
 */
class CaptionBurnerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CaptionBurner")

    // Burning captions re-encodes the video, which on a minute of 4K is tens
    // of seconds. A spinner with no number reads as a hang.
    Events("onBurnProgress")

    AsyncFunction("getInfo") { uri: String ->
      val retriever = MediaMetadataRetriever()
      try {
        retriever.setDataSource(path(uri))
        val width = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull()
          ?: throw Exception("The file contains no video track.")
        val height = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull()
          ?: throw Exception("The file contains no video track.")
        val rotation = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
        val duration = (retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L) / 1000.0

        // Stored dimensions ignore the camera's rotation. A portrait clip is
        // stored landscape with a quarter-turn flag, and laying captions out
        // against the stored size puts every one of them off-screen.
        val rotated = rotation == 90 || rotation == 270
        mapOf(
          "duration" to duration,
          "width" to if (rotated) height else width,
          "height" to if (rotated) width else height,
        )
      } finally {
        runCatching { retriever.release() }
      }
    }

    AsyncFunction("extractAudio") { uri: String ->
      val output = File(cacheDir(), "capflow_${System.currentTimeMillis()}.wav")
      AudioExtractor.toWav(path(uri), output)
      mapOf(
        "uri" to Uri.fromFile(output).toString(),
        "sampleRate" to AudioExtractor.SAMPLE_RATE,
      )
    }

    AsyncFunction("burn") { uri: String, plan: String ->
      val output = File(cacheDir(), "capflow_${System.currentTimeMillis()}.mp4")
      VideoBurner.burn(path(uri), plan, output) { fraction ->
        sendEvent("onBurnProgress", mapOf("progress" to fraction))
      }
      mapOf("uri" to Uri.fromFile(output).toString())
    }
  }

  private fun cacheDir(): File =
    appContext.reactContext?.cacheDir ?: throw Exception("No cache directory is available.")

  /**
   * MediaExtractor and MediaMetadataRetriever take file paths, while the picker
   * hands back a file:// URI.
   */
  private fun path(uri: String): String {
    if (uri.startsWith("file://")) return Uri.parse(uri).path ?: uri
    return uri
  }
}
