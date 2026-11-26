import { RGBA } from "@opentui/core"

const LIGHT_MODE_DARKEN = 0.6

// Theme success greens are tuned for dark backgrounds and wash out on white.
export function readable(color: RGBA, mode: "dark" | "light") {
  if (mode !== "light") return color
  return RGBA.fromValues(
    color.r * LIGHT_MODE_DARKEN,
    color.g * LIGHT_MODE_DARKEN,
    color.b * LIGHT_MODE_DARKEN,
    color.a,
  )
}
