import { describe, expect, it } from 'vitest'
import { deflateSync } from 'node:zlib'
import { inspectImage } from './validation.js'

const chunk = (type: string, data: Buffer): Buffer => {
  const body = Buffer.concat([Buffer.from(type), data])
  let crc = 0xffffffff
  for (const byte of body) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  const result = Buffer.alloc(4)
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  return Buffer.concat([length, body, result])
}

function pngFixture(): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(1, 0)
  ihdr.writeUInt32BE(1, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const scanline = Buffer.from([0, 255, 0, 0, 255])
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(scanline)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

describe('inspectImage', () => {
  it('accepts a complete PNG', () => expect(inspectImage(pngFixture())).toEqual({ mediaType: 'image/png', width: 1, height: 1 }))
  it('rejects truncated PNG data', () => expect(inspectImage(pngFixture().subarray(0, -1))).toBeUndefined())
  it('rejects PNG polyglots and trailing bytes', () => expect(inspectImage(Buffer.concat([pngFixture(), Buffer.from('<script>alert(1)</script>')]))).toBeUndefined())
  it('rejects corrupted PNG chunk data', () => {
    const corrupted = pngFixture()
    corrupted[corrupted.length - 20] ^= 1
    expect(inspectImage(corrupted)).toBeUndefined()
  })

  it('rejects truncated JPEG markers', () => expect(inspectImage(Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00]))).toBeUndefined())
  it('rejects RIFF trailing bytes', () => {
    const payload = Buffer.from([0, 0, 0, 0x9d, 0x01, 0x2a, 1, 0, 1, 0])
    const chunk = Buffer.concat([Buffer.from('VP8 '), Buffer.from([10, 0, 0, 0]), payload])
    const riff = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), chunk])
    riff.writeUInt32LE(riff.length - 8, 4)
    expect(inspectImage(riff)).toEqual({ mediaType: 'image/webp', width: 1, height: 1 })
    expect(inspectImage(Buffer.concat([riff, Buffer.from('extra')]))).toBeUndefined()
  })
})
