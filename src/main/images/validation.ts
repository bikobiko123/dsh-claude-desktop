import { inflateSync } from 'node:zlib'
import type { ImageMediaType, ImageSelectionLimits, ImageSelectionRequest } from '../../shared/desktop-api.js'

export const DEFENSIVE_IMAGE_LIMITS: ImageSelectionLimits = Object.freeze({
  maxImageBytes: 20 * 1024 * 1024,
  maxImagesPerMessage: 10,
  maxMessageImageBytes: 50 * 1024 * 1024,
  maxImagePixels: 100_000_000,
  mediaTypes: Object.freeze(['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const),
})

const supported = new Set<ImageMediaType>(DEFENSIVE_IMAGE_LIMITS.mediaTypes)
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

type InspectedImage = { mediaType: ImageMediaType; width: number; height: number }

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fallback
}

export function sanitizeImageSelectionRequest(value: unknown): Required<ImageSelectionRequest> {
  const request = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
  const rawLimits = typeof request.limits === 'object' && request.limits !== null ? request.limits as Record<string, unknown> : {}
  const requestedTypes = Array.isArray(rawLimits.mediaTypes)
    ? rawLimits.mediaTypes.filter((item): item is ImageMediaType => typeof item === 'string' && supported.has(item as ImageMediaType))
    : [...DEFENSIVE_IMAGE_LIMITS.mediaTypes]
  return {
    selectedCount: Math.max(0, positiveInteger(request.selectedCount, 0)),
    selectedBytes: Math.max(0, positiveInteger(request.selectedBytes, 0)),
    limits: {
      maxImageBytes: Math.min(positiveInteger(rawLimits.maxImageBytes, DEFENSIVE_IMAGE_LIMITS.maxImageBytes), DEFENSIVE_IMAGE_LIMITS.maxImageBytes),
      maxImagesPerMessage: Math.min(positiveInteger(rawLimits.maxImagesPerMessage, DEFENSIVE_IMAGE_LIMITS.maxImagesPerMessage), DEFENSIVE_IMAGE_LIMITS.maxImagesPerMessage),
      maxMessageImageBytes: Math.min(positiveInteger(rawLimits.maxMessageImageBytes, DEFENSIVE_IMAGE_LIMITS.maxMessageImageBytes), DEFENSIVE_IMAGE_LIMITS.maxMessageImageBytes),
      maxImagePixels: Math.min(positiveInteger(rawLimits.maxImagePixels, DEFENSIVE_IMAGE_LIMITS.maxImagePixels), DEFENSIVE_IMAGE_LIMITS.maxImagePixels),
      mediaTypes: requestedTypes.length ? requestedTypes : [],
    },
  }
}

function png(buffer: Buffer): InspectedImage | undefined {
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return
  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  let sawHeader = false
  let sawPalette = false
  let sawData = false
  let idat = Buffer.alloc(0)
  let idatEnded = false
  let ended = false

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const end = offset + 12 + length
    if (end > buffer.length) return
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    const crc = buffer.readUInt32BE(offset + 8 + length)
    // CRC validation catches damaged chunks and makes the parser independent of extensions.
    if (crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])) !== crc) return
    offset = end

    if (!sawHeader && type !== 'IHDR') return
    if (type === 'IHDR') {
      if (sawHeader || length !== 13) return
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
      if (!width || !height || ![0, 2, 3, 4, 6].includes(colorType) || ![1, 2, 4, 8, 16].includes(bitDepth)) return
      if (colorType === 3 && ![1, 2, 4, 8].includes(bitDepth)) return
      if (colorType === 0 && ![1, 2, 4, 8, 16].includes(bitDepth)) return
      if (colorType === 2 && ![8, 16].includes(bitDepth)) return
      if (colorType === 4 && ![8, 16].includes(bitDepth)) return
      if (colorType === 6 && ![8, 16].includes(bitDepth)) return
      // Interlaced scanline reconstruction is deliberately not attempted here.
      if (interlace !== 0) return
      sawHeader = true
    } else if (type === 'IDAT') {
      if (!sawHeader || !length || idatEnded || (colorType === 3 && !sawPalette)) return
      sawData = true
      idat = Buffer.concat([idat, data])
    } else if (type === 'IEND') {
      if (length !== 0 || !sawHeader || !sawData || ended) return
      ended = true
      if (offset !== buffer.length) return
    } else if (type === 'PLTE') {
      if (sawData || sawPalette || length === 0 || length % 3 !== 0 || length > 768 || colorType === 0 || colorType === 4) return
      sawPalette = true
    } else {
      if (ended) return
      if ((type.charCodeAt(0) & 0x20) === 0) return
      if (sawData) idatEnded = true
    }
  }
  if (!ended) return

  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 3 ? 1 : colorType === 4 ? 2 : 4
  const bitsPerPixel = channels * bitDepth
  const rowBytes = Math.ceil(width * bitsPerPixel / 8)
  const expected = (rowBytes + 1) * height
  if (!Number.isSafeInteger(expected) || expected > 64 * 1024 * 1024) return
  try {
    const inflated = inflateSync(idat, { maxOutputLength: expected + 1 })
    if (inflated.length !== expected) return
  } catch { return }
  return { mediaType: 'image/png', width, height }
}

function gif(buffer: Buffer): InspectedImage | undefined {
  if (buffer.length < 14 || !['GIF87a', 'GIF89a'].includes(buffer.toString('ascii', 0, 6))) return
  const width = buffer.readUInt16LE(6)
  const height = buffer.readUInt16LE(8)
  if (!width || !height) return
  let offset = 13
  if (buffer[10] & 0x80) offset += 3 * (1 << ((buffer[10] & 7) + 1))
  let images = 0
  while (offset < buffer.length) {
    const marker = buffer[offset++]
    if (marker === 0x3b) return offset === buffer.length && images > 0 ? { mediaType: 'image/gif', width, height } : undefined
    if (marker === 0x21) {
      if (offset >= buffer.length) return
      offset++
      offset = gifSubBlocks(buffer, offset)
      if (offset < 0) return
    } else if (marker === 0x2c) {
      if (offset + 9 > buffer.length) return
      const packed = buffer[offset + 8]
      offset += 9
      if (packed & 0x80) offset += 3 * (1 << ((packed & 7) + 1))
      if (offset >= buffer.length) return
      const lzwMin = buffer[offset++]
      if (lzwMin < 2 || lzwMin > 8) return
      offset = gifSubBlocks(buffer, offset)
      if (offset < 0) return
      images++
    } else return
  }
}
function gifSubBlocks(buffer: Buffer, offset: number): number {
  while (offset < buffer.length) {
    const length = buffer[offset++]
    if (length === 0) return offset
    if (offset + length > buffer.length) return -1
    offset += length
  }
  return -1
}

function jpeg(buffer: Buffer): InspectedImage | undefined {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return
  let offset = 2
  let dimensions: InspectedImage | undefined
  let sawScan = false
  while (offset < buffer.length) {
    if (buffer[offset++] !== 0xff) return
    while (offset < buffer.length && buffer[offset] === 0xff) offset++
    if (offset >= buffer.length) return
    const marker = buffer[offset++]
    if (marker === 0xd9) return dimensions && sawScan && offset === buffer.length ? dimensions : undefined
    if (marker === 0xda) {
      if (offset + 2 > buffer.length) return
      const length = buffer.readUInt16BE(offset)
      if (length < 2 || offset + length > buffer.length) return
      offset += length
      sawScan = true
      let sawEnd = false
      while (offset < buffer.length) {
        if (buffer[offset++] !== 0xff) continue
        if (offset >= buffer.length) return
        const next = buffer[offset++]
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) continue
        if (next === 0xd9) { sawEnd = true; break }
        if (next === 0xff) { offset--; continue }
        offset -= 2
        break
      }
      if (sawEnd) return dimensions && sawScan && offset === buffer.length ? dimensions : undefined
      continue
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > buffer.length) return
    const length = buffer.readUInt16BE(offset)
    if (length < 2 || offset + length > buffer.length) return
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      if (length < 7 || dimensions) return
      const height = buffer.readUInt16BE(offset + 3)
      const width = buffer.readUInt16BE(offset + 5)
      if (!width || !height) return
      dimensions = { mediaType: 'image/jpeg', width, height }
    }
    offset += length
  }
}

function webp(buffer: Buffer): InspectedImage | undefined {
  if (buffer.length < 20 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP' || buffer.readUInt32LE(4) !== buffer.length - 8) return
  let offset = 12
  let image: InspectedImage | undefined
  let sawPayload = false
  while (offset + 8 <= buffer.length) {
    const type = buffer.toString('ascii', offset, offset + 4)
    const length = buffer.readUInt32LE(offset + 4)
    const end = offset + 8 + length + (length & 1)
    if (end > buffer.length) return
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'VP8X') {
      if (length !== 10 || image) return
      image = { mediaType: 'image/webp', width: 1 + data.readUIntLE(4, 3), height: 1 + data.readUIntLE(7, 3) }
    } else if (type === 'VP8 ') {
      if (length < 10 || sawPayload || data[3] !== 0x9d || data[4] !== 0x01 || data[5] !== 0x2a) return
      const dimensions = { mediaType: 'image/webp' as const, width: data.readUInt16LE(6) & 0x3fff, height: data.readUInt16LE(8) & 0x3fff }
      if (image && (image.width !== dimensions.width || image.height !== dimensions.height)) return
      image ??= dimensions
      sawPayload = true
    } else if (type === 'VP8L') {
      if (length < 5 || sawPayload || data[0] !== 0x2f) return
      const bits = data.readUInt32LE(1)
      const dimensions = { mediaType: 'image/webp' as const, width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
      if (image && (image.width !== dimensions.width || image.height !== dimensions.height)) return
      image ??= dimensions
      sawPayload = true
    }
    offset = end
  }
  return offset === buffer.length && sawPayload ? image : undefined
}

export function inspectImage(buffer: Buffer): InspectedImage | undefined {
  return png(buffer) ?? jpeg(buffer) ?? webp(buffer) ?? gif(buffer)
}

// Small table-free CRC-32 implementation for PNG chunk integrity checks.
function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}
