import { describe, expect, it } from 'vitest';
import { boxToCropRect, levelRange, normalizeBox } from './image';

const W = 1920;
const H = 1080;

describe('boxToCropRect — coordinate spaces', () => {
  it('treats 0..1 values as normalised', () => {
    const r = boxToCropRect({ x0: 0.4, y0: 0.5, x1: 0.6, y1: 0.55 }, W, H, 0, 0)!;
    expect(r.sx).toBeCloseTo(768);
    expect(r.sy).toBeCloseTo(540);
    expect(r.sw).toBeCloseTo(384);
    expect(r.sh).toBeCloseTo(54);
  });

  it('treats large values as absolute pixels', () => {
    const r = boxToCropRect({ x0: 768, y0: 540, x1: 1152, y1: 594 }, W, H, 0, 0)!;
    expect(r.sx).toBeCloseTo(768);
    expect(r.sw).toBeCloseTo(384);
    expect(r.sh).toBeCloseTo(54);
  });
});

describe('boxToCropRect — padding', () => {
  it('expands the box and pads vertically more than horizontally', () => {
    const box = { x0: 0.4, y0: 0.5, x1: 0.6, y1: 0.55 };
    const bare = boxToCropRect(box, W, H, 0, 0)!;
    const padded = boxToCropRect(box, W, H, 0.08, 0.25)!;

    expect(padded.sw).toBeGreaterThan(bare.sw);
    expect(padded.sh).toBeGreaterThan(bare.sh);
    // Vertical padding is proportionally larger — glyphs sit near the border.
    expect(padded.sh / bare.sh).toBeGreaterThan(padded.sw / bare.sw);
  });

  it('keeps the padded crop inside the image at every edge', () => {
    for (const box of [
      { x0: 0, y0: 0, x1: 0.2, y1: 0.1 }, // top-left corner
      { x0: 0.8, y0: 0.9, x1: 1, y1: 1 }, // bottom-right corner
      { x0: 0.45, y0: 0, x1: 0.55, y1: 0.05 }, // flush against the top
    ]) {
      const r = boxToCropRect(box, W, H)!;
      expect(r).not.toBeNull();
      expect(r.sx).toBeGreaterThanOrEqual(0);
      expect(r.sy).toBeGreaterThanOrEqual(0);
      expect(r.sx + r.sw).toBeLessThanOrEqual(W + 1e-6);
      expect(r.sy + r.sh).toBeLessThanOrEqual(H + 1e-6);
    }
  });
});

describe('boxToCropRect — rejections', () => {
  it('rejects zero-size and inverted boxes', () => {
    expect(boxToCropRect({ x0: 0.5, y0: 0.5, x1: 0.5, y1: 0.5 }, W, H)).toBeNull();
    expect(boxToCropRect({ x0: 0.6, y0: 0.6, x1: 0.4, y1: 0.4 }, W, H)).toBeNull();
  });

  it('rejects a full-frame box — cropping to it would be a no-op', () => {
    expect(boxToCropRect({ x0: 0, y0: 0, x1: 1, y1: 1 }, W, H)).toBeNull();
  });

  it('rejects boxes too small to carry readable characters', () => {
    expect(boxToCropRect({ x0: 0.5, y0: 0.5, x1: 0.502, y1: 0.5005 }, W, H)).toBeNull();
  });
});

describe('normalizeBox', () => {
  it('leaves an already-normalised box alone', () => {
    const box = { x0: 0.4, y0: 0.5, x1: 0.6, y1: 0.55 };
    expect(normalizeBox(box, 1024, 576)).toEqual(box);
  });

  // The point of the helper: a box detected on the small copy must crop the
  // same region out of the full-resolution original.
  it('converts pixel coords into fractions of the detect image', () => {
    const box = normalizeBox({ x0: 512, y0: 288, x1: 768, y1: 316 }, 1024, 576);
    expect(box.x0).toBeCloseTo(0.5);
    expect(box.y0).toBeCloseTo(0.5);
    expect(box.x1).toBeCloseTo(0.75);

    const rect = boxToCropRect(box, 4000, 2250, 0, 0)!;
    expect(rect.sx).toBeCloseTo(2000);
    expect(rect.sw).toBeCloseTo(1000);
  });
});

describe('levelRange', () => {
  function histogram(fill: (h: Uint32Array) => void): Uint32Array {
    const h = new Uint32Array(256);
    fill(h);
    return h;
  }

  it('finds the black and white points of a washed-out frame', () => {
    // Glare: everything squeezed into the bright end, 140..200.
    const range = levelRange(histogram((h) => h.fill(100, 140, 201)))!;
    expect(range[0]).toBeGreaterThanOrEqual(140);
    expect(range[1]).toBeLessThanOrEqual(200);
    expect(range[1] - range[0]).toBeGreaterThan(24);
  });

  it('declines when the frame already spans the range', () => {
    expect(levelRange(histogram((h) => h.fill(10)))).toBeNull();
  });

  it('declines on a flat frame rather than amplifying noise', () => {
    expect(levelRange(histogram((h) => h.fill(500, 120, 130)))).toBeNull();
  });

  it('declines on an empty histogram', () => {
    expect(levelRange(new Uint32Array(256))).toBeNull();
  });
});
