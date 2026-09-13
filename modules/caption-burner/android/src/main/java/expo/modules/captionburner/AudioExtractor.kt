package expo.modules.captionburner

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Decodes a video's audio to the one format whisper accepts: 16 kHz, mono,
 * 16-bit WAV.
 *
 * Camera audio is typically 44.1 or 48 kHz stereo AAC, so all three properties
 * have to change. Rate conversion averages the source samples that fall in each
 * output sample rather than picking one of them: plain decimation folds
 * everything above 8 kHz back down into the speech band as aliasing, which is
 * audible as a lisp and measurably worse for recognition.
 */
internal object AudioExtractor {

  class NoAudio : Exception("This video has no audio to transcribe.")

  const val SAMPLE_RATE = 16_000

  fun toWav(inputPath: String, outputFile: File): File {
    val extractor = MediaExtractor()
    extractor.setDataSource(inputPath)

    var track = -1
    for (index in 0 until extractor.trackCount) {
      val mime = extractor.getTrackFormat(index).getString(MediaFormat.KEY_MIME) ?: continue
      if (mime.startsWith("audio/")) { track = index; break }
    }
    if (track < 0) {
      extractor.release()
      throw NoAudio()
    }

    extractor.selectTrack(track)
    val format = extractor.getTrackFormat(track)
    val decoder = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME)!!)
    decoder.configure(format, null, null, 0)
    decoder.start()

    val file = RandomAccessFile(outputFile, "rw")
    file.setLength(0)
    // Length is unknown until the decode finishes, so the header goes down with
    // zeroed sizes and is patched in place afterwards.
    file.write(wavHeader(0))

    var sourceRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
    var channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)

    var written = 0
    var sourceIndex = 0L
    var currentBucket = -1L
    var bucketSum = 0L
    var bucketCount = 0
    var lastValue = 0
    val out = ByteBuffer.allocate(8192).order(ByteOrder.LITTLE_ENDIAN)

    fun emit(value: Int) {
      if (out.remaining() < 2) {
        file.write(out.array(), 0, out.position())
        written += out.position()
        out.clear()
      }
      out.putShort(value.coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt()).toShort())
    }

    val info = MediaCodec.BufferInfo()
    var inputDone = false
    var outputDone = false

    try {
      while (!outputDone) {
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

        val index = decoder.dequeueOutputBuffer(info, 10_000)
        when {
          index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
            // The decoder is the authority on what it actually produced; the
            // extractor's format can differ from the decoded stream.
            val decoded = decoder.outputFormat
            sourceRate = decoded.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            channels = decoded.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
          }
          index >= 0 -> {
            val buffer = decoder.getOutputBuffer(index)!!
            buffer.position(info.offset)
            buffer.limit(info.offset + info.size)
            val shorts = buffer.order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()

            while (shorts.remaining() >= channels) {
              var frame = 0
              for (channel in 0 until channels) frame += shorts.get().toInt()
              val mono = frame / channels

              val bucket = sourceIndex * SAMPLE_RATE / sourceRate
              if (bucket != currentBucket) {
                if (bucketCount > 0) {
                  lastValue = (bucketSum / bucketCount).toInt()
                  emit(lastValue)
                }
                // Upsampling leaves buckets with no source sample in them;
                // holding the previous value keeps the output continuous
                // rather than punching silence into it.
                var gap = currentBucket + 1
                while (currentBucket >= 0 && gap < bucket) { emit(lastValue); gap++ }
                currentBucket = bucket
                bucketSum = 0
                bucketCount = 0
              }
              bucketSum += mono
              bucketCount++
              sourceIndex++
            }

            decoder.releaseOutputBuffer(index, false)
            if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputDone = true
          }
        }
      }

      if (bucketCount > 0) emit((bucketSum / bucketCount).toInt())
      if (out.position() > 0) {
        file.write(out.array(), 0, out.position())
        written += out.position()
      }
      if (written == 0) throw NoAudio()

      file.seek(0)
      file.write(wavHeader(written))
    } finally {
      runCatching { decoder.stop() }
      runCatching { decoder.release() }
      extractor.release()
      file.close()
    }

    return outputFile
  }

  /** A 44-byte canonical WAV header: whisper.rn opens the file itself. */
  private fun wavHeader(dataBytes: Int): ByteArray {
    val channels = 1
    val bits = 16
    val buffer = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
    buffer.put("RIFF".toByteArray())
    buffer.putInt(36 + dataBytes)
    buffer.put("WAVE".toByteArray())
    buffer.put("fmt ".toByteArray())
    buffer.putInt(16)
    buffer.putShort(1)
    buffer.putShort(channels.toShort())
    buffer.putInt(SAMPLE_RATE)
    buffer.putInt(SAMPLE_RATE * channels * bits / 8)
    buffer.putShort((channels * bits / 8).toShort())
    buffer.putShort(bits.toShort())
    buffer.put("data".toByteArray())
    buffer.putInt(dataBytes)
    return buffer.array()
  }
}
