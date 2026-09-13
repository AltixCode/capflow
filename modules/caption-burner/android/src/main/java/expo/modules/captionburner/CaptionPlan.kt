package expo.modules.captionburner

import android.graphics.Color
import org.json.JSONObject

/**
 * The caption layout, as computed in JavaScript.
 *
 * Both platforms decode the same object. The layout lives in one place on
 * purpose: three implementations of "where does the caption go" is three
 * chances for the export not to match the preview the user approved.
 */
data class CaptionStyle(
  val color: Int,
  val strokeColor: Int?,
  val strokeRatio: Float,
  val plateColor: Int?,
  val plateRadiusRatio: Float,
) {
  companion object {
    fun from(json: JSONObject): CaptionStyle = CaptionStyle(
      color = parseColor(json.optString("color")) ?: Color.WHITE,
      strokeColor = parseColor(json.optString("strokeColor")),
      strokeRatio = json.optDouble("strokeRatio", 0.0).toFloat(),
      plateColor = parseColor(json.optString("plateColor")),
      plateRadiusRatio = json.optDouble("plateRadiusRatio", 0.0).toFloat(),
    )

    /**
     * #RRGGBB or #RRGGBBAA, which is what the style presets use.
     *
     * Android's own parser reads #AARRGGBB, so handing it a CSS-ordered string
     * silently produces a colour with the alpha and red channels swapped --
     * a caption that renders, in the wrong colour, at the wrong opacity.
     */
    fun parseColor(value: String?): Int? {
      val hex = value?.trim()?.removePrefix("#") ?: return null
      if (hex.length != 6 && hex.length != 8) return null
      val number = hex.toLongOrNull(16) ?: return null
      return if (hex.length == 6) {
        Color.argb(255, (number shr 16 and 0xFF).toInt(), (number shr 8 and 0xFF).toInt(), (number and 0xFF).toInt())
      } else {
        Color.argb(
          (number and 0xFF).toInt(),
          (number shr 24 and 0xFF).toInt(),
          (number shr 16 and 0xFF).toInt(),
          (number shr 8 and 0xFF).toInt(),
        )
      }
    }
  }
}

data class CaptionBox(
  val lines: List<String>,
  val startUs: Long,
  /** Exclusive, so exactly one caption is on screen at a time. */
  val endUs: Long,
  val fontSize: Float,
  val lineHeight: Float,
  val top: Float,
  val width: Float,
  val maxWidth: Float,
) {
  val height: Float get() = lineHeight * lines.size
}

data class CaptionPlan(
  val videoWidth: Float,
  val videoHeight: Float,
  val style: CaptionStyle,
  val boxes: List<CaptionBox>,
) {
  /** Index of the caption visible at a time, or -1 between captions. */
  fun indexAt(timeUs: Long): Int = boxes.indexOfFirst { timeUs >= it.startUs && timeUs < it.endUs }

  companion object {
    fun parse(json: String): CaptionPlan? {
      val root = runCatching { JSONObject(json) }.getOrNull() ?: return null
      val video = root.optJSONObject("video") ?: return null
      val styleJson = root.optJSONObject("style") ?: return null
      val boxesJson = root.optJSONArray("boxes") ?: return null

      val boxes = mutableListOf<CaptionBox>()
      for (index in 0 until boxesJson.length()) {
        val box = boxesJson.optJSONObject(index) ?: continue
        val linesJson = box.optJSONArray("lines") ?: continue
        val lines = (0 until linesJson.length()).mapNotNull { linesJson.optString(it).ifBlank { null } }
        if (lines.isEmpty()) continue
        boxes.add(
          CaptionBox(
            lines = lines,
            // The plan is in milliseconds; every Android media API is in
            // microseconds, and mixing the two silently puts every caption in
            // the first thousandth of the video.
            startUs = (box.optDouble("startMs", 0.0) * 1000).toLong(),
            endUs = (box.optDouble("endMs", 0.0) * 1000).toLong(),
            fontSize = box.optDouble("fontSize", 0.0).toFloat(),
            lineHeight = box.optDouble("lineHeight", 0.0).toFloat(),
            top = box.optDouble("top", 0.0).toFloat(),
            width = box.optDouble("width", 0.0).toFloat(),
            maxWidth = box.optDouble("maxWidth", 0.0).toFloat(),
          )
        )
      }

      return CaptionPlan(
        videoWidth = video.optDouble("width", 0.0).toFloat(),
        videoHeight = video.optDouble("height", 0.0).toFloat(),
        style = CaptionStyle.from(styleJson),
        boxes = boxes,
      )
    }
  }
}
