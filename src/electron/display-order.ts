export interface OrderedDisplayLike {
  id: number;
  workArea: { x: number; y: number };
}

export function orderDisplays<T extends OrderedDisplayLike>(
  displays: readonly T[],
  primaryDisplayId: number,
) {
  return [...displays].sort((left, right) => {
    const leftIsPrimary = left.id === primaryDisplayId;
    const rightIsPrimary = right.id === primaryDisplayId;

    if (leftIsPrimary !== rightIsPrimary) return leftIsPrimary ? -1 : 1;

    return (
      left.workArea.y - right.workArea.y ||
      left.workArea.x - right.workArea.x ||
      left.id - right.id
    );
  });
}
