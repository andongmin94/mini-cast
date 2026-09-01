export interface CommittedRenderState {
  displayId: number | null;
  viewportWidth: number | null;
  viewportHeight: number | null;
  canvasWidth: number;
  canvasHeight: number;
  strokeIds: readonly string[];
}

export interface CommittedRenderPlan {
  reset: boolean;
  appendFrom: number;
}

function sameSurface(
  previous: CommittedRenderState,
  next: CommittedRenderState,
) {
  return (
    previous.displayId === next.displayId &&
    previous.viewportWidth === next.viewportWidth &&
    previous.viewportHeight === next.viewportHeight &&
    previous.canvasWidth === next.canvasWidth &&
    previous.canvasHeight === next.canvasHeight
  );
}

export function planCommittedRender(
  previous: CommittedRenderState | null,
  next: CommittedRenderState,
): CommittedRenderPlan {
  if (!previous || !sameSurface(previous, next)) {
    return { reset: true, appendFrom: 0 };
  }

  if (previous.strokeIds.length > next.strokeIds.length) {
    return { reset: true, appendFrom: 0 };
  }

  for (let index = 0; index < previous.strokeIds.length; index += 1) {
    if (previous.strokeIds[index] !== next.strokeIds[index]) {
      return { reset: true, appendFrom: 0 };
    }
  }

  return { reset: false, appendFrom: previous.strokeIds.length };
}
