package expo.modules.captionburner

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface

/**
 * Draws one caption into a transparent bitmap the size of the video frame.
 *
 * A full-frame bitmap rather than a cropped one: the GL pass then blends it
 * over the frame with a single full-screen quad, so the caption's position
 * comes entirely from the layout and there is no second place to get the
 * geometry wrong.
 */
class CaptionOverlayRenderer(
  private val width: Int,
  private val height: Int,
  private val style: CaptionStyle,
  /** Video pixels per plan unit, in case the decoder reports a different size. */
  private val scale: Float,
) {
  private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
    textAlign = Paint.Align.CENTER
    color = style.color
  }
  private val stroke = Paint(fill).apply {
    style = Paint.Style.STROKE
    strokeJoin = Paint.Join.ROUND
  }
  private val plate = Paint(Paint.ANTI_ALIAS_FLAG)

  fun render(box: CaptionBox): Bitmap {
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)

    var fontSize = box.fontSize * scale
    fill.textSize = fontSize
    // The layout chose the line breaks with an estimated glyph width. Here the
    // real typeface is available, so the size is nudged to fit -- but the line
    // breaks are kept, because re-wrapping would put a different number of
    // lines on screen than the preview showed.
    val maxWidth = minOf(box.maxWidth * scale, width.toFloat())
    val widest = box.lines.maxOf { fill.measureText(it) }
    if (widest > maxWidth && widest > 0) {
      fontSize *= maxWidth / widest
      fill.textSize = fontSize
    }
    stroke.textSize = fontSize
    stroke.strokeWidth = fontSize * style.strokeRatio

    val lineHeight = box.lineHeight * scale
    val blockTop = box.top * scale
    val blockHeight = lineHeight * box.lines.size
    val centerX = width / 2f

    style.plateColor?.let { color ->
      plate.color = color
      val padX = fontSize * 0.42f
      val padY = fontSize * 0.22f
      val fitted = box.lines.maxOf { fill.measureText(it) }
      val plateWidth = minOf(width.toFloat(), fitted + padX * 2)
      val radius = fontSize * style.plateRadiusRatio
      canvas.drawRoundRect(
        RectF(
          centerX - plateWidth / 2,
          blockTop - padY,
          centerX + plateWidth / 2,
          blockTop + blockHeight + padY,
        ),
        radius,
        radius,
        plate,
      )
    }

    box.lines.forEachIndexed { index, line ->
      // drawText places the baseline; the plan measures the top of the line
      // box, so each line drops by the box plus the cap offset.
      val baseline = blockTop + index * lineHeight + (lineHeight + fontSize * 0.72f) / 2
      if (style.strokeColor != null && style.strokeRatio > 0) {
        stroke.color = style.strokeColor
        canvas.drawText(line, centerX, baseline, stroke)
      }
      canvas.drawText(line, centerX, baseline, fill)
    }

    return bitmap
  }
}
