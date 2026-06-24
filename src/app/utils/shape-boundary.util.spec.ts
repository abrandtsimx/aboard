import { shapeBoundaryDistance } from './shape-boundary.util';

describe('shapeBoundaryDistance', () => {
  const size = 100;

  it('matches the circle/ellipse outer stroke on cardinal rays', () => {
    expect(shapeBoundaryDistance('circle', 1, 0, size)).toBeCloseTo(50, 1);
    expect(shapeBoundaryDistance('circle', 0, -1, size)).toBeCloseTo(50, 1);
    expect(shapeBoundaryDistance('ellipse', 1, 0, size)).toBeCloseTo(46, 1);
    expect(shapeBoundaryDistance('ellipse', 0, 1, size)).toBeCloseTo(37, 1);
  });

  it('hits diamond vertices on horizontal and vertical rays', () => {
    expect(shapeBoundaryDistance('diamond', 1, 0, size)).toBeCloseTo(50, 1);
    expect(shapeBoundaryDistance('diamond', 0, -1, size)).toBeCloseTo(50, 1);
  });

  it('lands on diamond edges before the bounding box on diagonal rays', () => {
    const diag = shapeBoundaryDistance('diamond', 1, 1, size);
    expect(diag).toBeLessThan(50);
    expect(diag).toBeGreaterThan(34);
  });

  it('hits rounded-square flat sides on cardinal rays', () => {
    expect(shapeBoundaryDistance('rounded-square', 1, 0, size)).toBeCloseTo(50, 1);
    expect(shapeBoundaryDistance('rounded-square', 0, 1, size)).toBeCloseTo(50, 1);
  });

  it('meets hexagon flat sides on horizontal rays', () => {
    expect(shapeBoundaryDistance('hexagon', 1, 0, size)).toBeCloseTo(50, 1);
    expect(shapeBoundaryDistance('hexagon', -1, 0, size)).toBeCloseTo(50, 1);
  });

  it('returns shorter offsets than size/2 for shallow diamond approaches', () => {
    const shallow = shapeBoundaryDistance('diamond', 1, 0.35, size);
    expect(shallow).toBeLessThan(size / 2);
  });
});
