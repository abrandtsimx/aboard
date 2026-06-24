import { getNodeCategory, isDetailSatelliteCategory } from './category.util';

describe('getNodeCategory', () => {
  it('derives styling category from built-in node types', () => {
    expect(getNodeCategory({ id: 'a', label: 'A', type: 'app', parentId: null })).toBe(
      'application'
    );
    expect(getNodeCategory({ id: 'd', label: 'D', type: 'item-type', parentId: null })).toBe(
      'data-type'
    );
    expect(getNodeCategory({ id: 'e', label: 'E', type: 'environment', parentId: null })).toBe(
      'environment'
    );
  });

  it('recognizes schema type ids used on curated boards', () => {
    expect(
      getNodeCategory({ id: 'c', label: 'Bucket', type: 'container', parentId: null })
    ).toBe('container');
    expect(
      getNodeCategory({ id: 'dt', label: 'Dialog', type: 'data-type', parentId: null })
    ).toBe('data-type');
    expect(
      getNodeCategory({ id: 'ext', label: 'AWS', type: 'external-tool', parentId: null })
    ).toBe('external-tool');
  });
});

describe('isDetailSatelliteCategory', () => {
  it('treats containers and data types as detail satellites', () => {
    expect(isDetailSatelliteCategory('container')).toBeTrue();
    expect(isDetailSatelliteCategory('data-type')).toBeTrue();
    expect(isDetailSatelliteCategory('application')).toBeFalse();
  });
});
