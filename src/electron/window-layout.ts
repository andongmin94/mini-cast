export interface RectLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WorkArea extends RectLike {
  id: number;
}

function intersectionArea(left: RectLike, right: RectLike) {
  const width = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) -
      Math.max(left.x, right.x),
  );
  const height = Math.max(
    0,
    Math.min(left.y + left.height, right.y + right.height) -
      Math.max(left.y, right.y),
  );
  return width * height;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function fitWindowToWorkAreas(
  current: RectLike,
  workAreas: readonly WorkArea[],
  primaryDisplayId: number,
): RectLike {
  if (!workAreas.length) return current;

  const overlap = workAreas
    .map((area) => ({ area, overlap: intersectionArea(current, area) }))
    .sort((left, right) => right.overlap - left.overlap)[0];
  const target =
    overlap && overlap.overlap > 0
      ? overlap.area
      : (workAreas.find((area) => area.id === primaryDisplayId) ?? workAreas[0]);

  const width = Math.min(Math.max(1, current.width), target.width);
  const height = Math.min(Math.max(1, current.height), target.height);
  const hadVisibleOverlap = Boolean(overlap && overlap.overlap > 0);
  const preferredX = hadVisibleOverlap
    ? current.x
    : target.x + Math.round((target.width - width) / 2);
  const preferredY = hadVisibleOverlap
    ? current.y
    : target.y + Math.round((target.height - height) / 2);

  return {
    x: clamp(preferredX, target.x, target.x + target.width - width),
    y: clamp(preferredY, target.y, target.y + target.height - height),
    width,
    height,
  };
}
