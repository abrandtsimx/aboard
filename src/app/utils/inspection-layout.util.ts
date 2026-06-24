/** Minimum bow magnitude (px) for a labeled inspection link assigned to a lane. */
export const INSPECTION_LANE_MIN_BOW = 55;

/** Spacing between parallel link labels along the chord (px). */
export const INSPECTION_LABEL_ALONG_SPACING = 32;

/** Symmetric lane offsets for `count` parallel links. */
export function linkLaneOffsets(count: number, laneSpacing: number): number[] {
  if (count <= 0) return [];
  return Array.from({ length: count }, (_, index) => (index - (count - 1) / 2) * laneSpacing);
}

/** Symmetric along-chord label offsets for `count` parallel links. */
export function labelAlongOffsets(count: number, spacing = INSPECTION_LABEL_ALONG_SPACING): number[] {
  if (count <= 0) return [];
  return Array.from({ length: count }, (_, index) => (index - (count - 1) / 2) * spacing);
}

/** Every unordered pair among hub neighbors (for collision spreading). */
export function hubNeighborPairs(neighborIds: string[]): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < neighborIds.length; i++) {
    for (let j = i + 1; j < neighborIds.length; j++) {
      pairs.push([neighborIds[i], neighborIds[j]]);
    }
  }
  return pairs;
}

/**
 * Keep lane-assigned bow signs while ensuring enough separation for labels.
 * When no lane is assigned, fall back to the approach fan offset.
 */
export function resolveInspectionCurveOffset(
  laneOffset: number | undefined,
  fanOffset: number,
  minLaneMagnitude = INSPECTION_LANE_MIN_BOW
): number {
  if (laneOffset !== undefined && Math.abs(laneOffset) >= 0.5) {
    const sign = Math.sign(laneOffset);
    return sign * Math.max(Math.abs(laneOffset), minLaneMagnitude);
  }
  return fanOffset;
}

export interface LinkLaneAssignable {
  id: string;
  curveOffset?: number;
  labelAlongOffset?: number;
}

/**
 * Assign curve and along-chord label offsets to parallel links in each group.
 * `groupKey` clusters only truly parallel edges (e.g. outbound links sharing a target).
 */
export interface ApplyLinkLaneOptions<T extends LinkLaneAssignable> {
  labelSpacing?: number;
  sort?: (left: T, right: T) => number;
}

export function applyLinkLaneOffsets<T extends LinkLaneAssignable>(
  specs: T[],
  match: (spec: T) => boolean,
  groupKey: (spec: T) => string,
  laneSpacing: number,
  options: ApplyLinkLaneOptions<T> = {}
): T[] {
  const matched = specs.filter(match);
  if (matched.length <= 1) return specs;

  const labelSpacing = options.labelSpacing ?? INSPECTION_LABEL_ALONG_SPACING;
  const sort = options.sort ?? ((left, right) => left.id.localeCompare(right.id));

  const byGroup = new Map<string, T[]>();
  for (const spec of matched) {
    const key = groupKey(spec);
    const group = byGroup.get(key);
    if (group) group.push(spec);
    else byGroup.set(key, [spec]);
  }

  const laneById = new Map<string, { curveOffset: number; labelAlongOffset: number }>();
  for (const group of byGroup.values()) {
    if (group.length <= 1) continue;
    const sorted = [...group].sort(sort);
    const lanes = linkLaneOffsets(sorted.length, laneSpacing);
    const along = labelAlongOffsets(sorted.length, labelSpacing);
    sorted.forEach((spec, index) => {
      laneById.set(spec.id, { curveOffset: lanes[index], labelAlongOffset: along[index] });
    });
  }

  if (laneById.size === 0) return specs;

  return specs.map((spec) => {
    const lane = laneById.get(spec.id);
    if (!lane) return spec;
    return { ...spec, curveOffset: lane.curveOffset, labelAlongOffset: lane.labelAlongOffset };
  });
}
