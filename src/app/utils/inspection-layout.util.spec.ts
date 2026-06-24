import {
  applyLinkLaneOffsets,
  hubNeighborPairs,
  INSPECTION_LABEL_ALONG_SPACING,
  INSPECTION_LANE_MIN_BOW,
  labelAlongOffsets,
  linkLaneOffsets,
  resolveInspectionCurveOffset,
} from './inspection-layout.util';

describe('inspection-layout.util', () => {
  describe('linkLaneOffsets', () => {
    it('returns symmetric offsets for parallel links', () => {
      expect(linkLaneOffsets(2, 38)).toEqual([-19, 19]);
      expect(linkLaneOffsets(3, 30)).toEqual([-30, 0, 30]);
    });
  });

  describe('labelAlongOffsets', () => {
    it('spaces labels along the chord', () => {
      expect(labelAlongOffsets(2)).toEqual([-16, 16]);
    });
  });

  describe('hubNeighborPairs', () => {
    it('enumerates unordered neighbor pairs', () => {
      expect(hubNeighborPairs(['a', 'b', 'c'])).toEqual([
        ['a', 'b'],
        ['a', 'c'],
        ['b', 'c'],
      ]);
    });
  });

  describe('resolveInspectionCurveOffset', () => {
    it('preserves lane sign without merging fan magnitude onto the wrong side', () => {
      expect(resolveInspectionCurveOffset(19, -62)).toBe(55);
      expect(resolveInspectionCurveOffset(-19, 62)).toBe(-55);
    });

    it('falls back to fan offset when no lane is assigned', () => {
      expect(resolveInspectionCurveOffset(undefined, 48)).toBe(48);
      expect(resolveInspectionCurveOffset(0, -62)).toBe(-62);
    });
  });

  describe('applyLinkLaneOffsets', () => {
    interface Spec {
      id: string;
      targetId: string;
      curveOffset?: number;
      labelAlongOffset?: number;
    }

    it('groups outbound links by target so unrelated edges are not fanned together', () => {
      const specs: Spec[] = [
        { id: 'a-jira', targetId: 'jira' },
        { id: 'b-s3', targetId: 's3' },
        { id: 'c-jira', targetId: 'jira' },
      ];
      const result = applyLinkLaneOffsets(
        specs,
        () => true,
        (spec) => spec.targetId,
        38
      );
      expect(result.find((s) => s.id === 'a-jira')?.curveOffset).toBe(-19);
      expect(result.find((s) => s.id === 'c-jira')?.curveOffset).toBe(19);
      expect(result.find((s) => s.id === 'b-s3')?.curveOffset).toBeUndefined();
    });

    it('assigns along-chord label offsets within each parallel group', () => {
      const specs: Spec[] = [
        { id: 'creator-jira', targetId: 'jira' },
        { id: 'editor-jira', targetId: 'jira' },
      ];
      const result = applyLinkLaneOffsets(
        specs,
        () => true,
        (spec) => spec.targetId,
        38,
        { labelSpacing: INSPECTION_LABEL_ALONG_SPACING }
      );
      expect(result.map((s) => s.labelAlongOffset)).toEqual([-16, 16]);
    });
  });
});
