import { describe, it, expect } from 'vitest'
import { checkFile, fitWithin, processImage, MAX_FILE_BYTES, MAX_SIDE } from './food-image.js'

describe('the photo pipeline', () => {
  it('accepts the formats a phone camera and gallery produce', () => {
    expect(checkFile({ type: 'image/jpeg', size: 4e6 })).toBeNull()
    expect(checkFile({ type: 'image/heic', size: 2e6 })).toBeNull()
    expect(checkFile({ type: '', name: 'IMG_0042.JPG', size: 2e6 })).toBeNull()      // a gallery that reports no type
  })
  it('turns away what is not a usable photo, with the reason', () => {
    expect(checkFile({ type: 'application/pdf', size: 1000 })).toBe('type')
    expect(checkFile({ type: 'video/mp4', size: 1000 })).toBe('type')
    expect(checkFile({ type: 'image/gif', size: 1000 })).toBe('type')
    expect(checkFile({ type: 'image/jpeg', size: MAX_FILE_BYTES + 1 })).toBe('size')
    expect(checkFile({ type: 'image/jpeg', size: 0 })).toBe('empty')
    expect(checkFile(null)).toBe('empty')
  })
  it('rejects before decoding anything', async () => {
    await expect(processImage({ type: 'text/plain', size: 10 })).rejects.toThrow('type')
  })
  it('shrinks to fit, keeps the shape, never enlarges', () => {
    expect(fitWithin(4000, 3000)).toEqual({ w: MAX_SIDE, h: 960 })
    expect(fitWithin(3000, 4000)).toEqual({ w: 960, h: MAX_SIDE })
    expect(fitWithin(800, 600)).toEqual({ w: 800, h: 600 })
    expect(fitWithin(5000, 10)).toEqual({ w: MAX_SIDE, h: 3 })
  })
})
