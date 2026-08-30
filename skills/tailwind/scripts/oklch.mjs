#!/usr/bin/env node
/**
 * Colour conversion for the tailwind skill. Zero dependencies, `node` only.
 * Transform is Ottosson's sRGB<->OKLab; `#3b82f6` -> `oklch(0.623 0.188 259.815)`
 * matches the reference value, so treat a drift there as a regression.
 *
 *   node oklch.mjs '#3b82f6'                 -> oklch(0.623 0.188 259.815)
 *   node oklch.mjs '#3b82f6' 'rgb(0 0 0 / .1)'
 *   node oklch.mjs --hex 'oklch(0.623 0.188 259.815)'   -> #3b82f6
 *   node oklch.mjs --table '#fff' '#3b82f6'  -> markdown Before/After rows
 *   echo '#3b82f6' | node oklch.mjs          -> reads stdin, one colour per line
 *
 * Accepts hex (3/4/6/8), rgb()/rgba(), hsl()/hsla(), oklch(). Alpha is carried
 * through as `/ A`, and dropped when it is 1. Out-of-sRGB-gamut results are
 * reported on stderr — the value still prints, since the browser will clip it.
 */

import { readFileSync } from "node:fs"

const round = (n, p = 3) => {
  const v = +n.toFixed(p)
  return Object.is(v, -0) ? 0 : v
}

// ---------- parsing ----------

/** @returns {{r:number,g:number,b:number,a:number}|null} r/g/b are 0-1 sRGB */
function parse(input) {
  const s = String(input).trim().toLowerCase()

  const hex = s.match(/^#([0-9a-f]{3,8})$/)
  if (hex) {
    let h = hex[1]
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("")
    if (h.length !== 6 && h.length !== 8) return null
    return {
      r: parseInt(h.slice(0, 2), 16) / 255,
      g: parseInt(h.slice(2, 4), 16) / 255,
      b: parseInt(h.slice(4, 6), 16) / 255,
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    }
  }

  const fn = s.match(/^(rgba?|hsla?|oklch)\(([^)]*)\)$/)
  if (!fn) return null
  const [, name, body] = fn
  const parts = body.split(/[\s,/]+/).filter(Boolean)
  if (parts.length < 3) return null
  const alphaTok = body.includes("/")
    ? body.split("/")[1].trim()
    : parts.length > 3
      ? parts[3]
      : null
  const a = alphaTok == null ? 1 : num(alphaTok)

  if (name.startsWith("rgb")) {
    return {
      r: chan(parts[0]),
      g: chan(parts[1]),
      b: chan(parts[2]),
      a,
    }
  }
  if (name.startsWith("hsl")) {
    return { ...hslToRgb(hue(parts[0]), num(parts[1]), num(parts[2])), a }
  }
  // oklch in -> straight back to rgb so every path shares one representation
  // (a chroma percentage is relative to 0.4, not to 1)
  const c = parts[1].endsWith("%") ? num(parts[1]) * 0.4 : parseFloat(parts[1])
  return { ...oklchToRgb(num(parts[0]), c, hue(parts[2])), a }
}

const num = (t) => (t.endsWith("%") ? parseFloat(t) / 100 : parseFloat(t))
const chan = (t) => (t.endsWith("%") ? parseFloat(t) / 100 : parseFloat(t) / 255)
const hue = (t) => {
  const v = parseFloat(t)
  if (t.endsWith("turn")) return v * 360
  if (t.endsWith("rad")) return (v * 180) / Math.PI
  if (t.endsWith("grad")) return v * 0.9
  return v
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const t = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][Math.floor(h / 60) % 6]
  return { r: t[0] + m, g: t[1] + m, b: t[2] + m }
}

// ---------- sRGB <-> OKLCH (Ottosson) ----------

const toLinear = (c) =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
const toGamma = (c) =>
  c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055

function rgbToOklch({ r, g, b }) {
  const R = toLinear(r),
    G = toLinear(g),
    B = toLinear(b)
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B)
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const Bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  const C = Math.hypot(A, Bb)
  let H = (Math.atan2(Bb, A) * 180) / Math.PI
  if (H < 0) H += 360
  return { L, C, H: C < 1e-6 ? 0 : H }
}

function oklchToRgb(L, C, H) {
  const h = (H * Math.PI) / 180
  const A = C * Math.cos(h),
    B = C * Math.sin(h)
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
  return {
    r: toGamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: toGamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: toGamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  }
}

// ---------- formatting ----------

const alpha = (a) => (a >= 0.999 ? "" : ` / ${round(a, 4)}`)

function fmtOklch({ r, g, b, a }) {
  const { L, C, H } = rgbToOklch({ r, g, b })
  return `oklch(${round(L)} ${round(C)} ${round(H)}${alpha(a)})`
}

function fmtHex({ r, g, b, a }) {
  const h = (c) =>
    Math.max(0, Math.min(255, Math.round(c * 255)))
      .toString(16)
      .padStart(2, "0")
  return `#${h(r)}${h(g)}${h(b)}${a >= 0.999 ? "" : h(a)}`
}

// Checked on the parsed sRGB triple, never on a round-trip of the rounded
// output: a hex or rgb() input is in gamut by construction, and re-deriving it
// from 3dp OKLCH makes every channel that sits at 0 or 255 look like clipping.
// So only an oklch() input can fail this, which is the only case that can.
const inGamut = ({ r, g, b }) =>
  [r, g, b].every((c) => c >= -0.0005 && c <= 1.0005)

// ---------- cli ----------

const argv = process.argv.slice(2)
const toHex = argv.includes("--hex")
const table = argv.includes("--table")
let inputs = argv.filter((a) => !a.startsWith("--"))

if (!inputs.length) {
  inputs = readFileSync(0, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
}

if (!inputs.length) {
  console.error("usage: node oklch.mjs [--hex] [--table] <colour> [...]")
  process.exit(2)
}

if (table) console.log("| Before | After |\n| --- | --- |")

let failed = false
for (const input of inputs) {
  const c = parse(input)
  if (!c) {
    console.error(`! not a colour, left alone: ${input}`)
    failed = true
    continue
  }
  const out = toHex ? fmtHex(c) : fmtOklch(c)
  if (!inGamut(c))
    console.error(
      `! out of sRGB gamut, the browser will clip it: ${input} -> ${out}`,
    )
  console.log(table ? `| \`${input}\` | \`${out}\` |` : out)
}
process.exit(failed ? 1 : 0)
