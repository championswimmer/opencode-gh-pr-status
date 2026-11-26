import assert from "node:assert/strict"
import { test } from "node:test"
import { RGBA } from "@opentui/core"
import { readable } from "../src/color"

const luminance = (color: RGBA) => {
  const [r, g, b] = [color.r, color.g, color.b].map((value) =>
    value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  )
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

test("keeps the theme color in dark mode", () => {
  const green = RGBA.fromHex("#22c55e")
  assert.equal(readable(green, "dark"), green)
})

test("darkens bright green for readable contrast on white in light mode", () => {
  const green = RGBA.fromHex("#22c55e")
  const darker = readable(green, "light")
  const contrast = (color: RGBA) => 1.05 / (luminance(color) + 0.05)
  assert.ok(contrast(darker) >= 4.5)
  assert.ok(contrast(darker) > contrast(green))
  assert.equal(darker.a, green.a)
})
