import { describe, expect, it } from 'vitest'
import { compositeSize } from './PhotoPreview'

describe('compositeSize', () => {
  it('scales a landscape photo to the max side', () => {
    expect(compositeSize(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 })
  })

  it('scales a portrait photo to the max side', () => {
    expect(compositeSize(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 })
  })

  it('does not enlarge a photo smaller than the max side', () => {
    expect(compositeSize(800, 600, 1600)).toEqual({ width: 800, height: 600 })
  })
})
