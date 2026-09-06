export interface AnnotationInputViewport {
  readonly width: number;
  readonly height: number;
  readonly ratio: number;
}

/** CSS dimensions and DPR are independent, even when their physical-pixel products match. */
export function sameAnnotationInputViewport(a: AnnotationInputViewport | null, b: AnnotationInputViewport): boolean {
  return a !== null && a.width === b.width && a.height === b.height && a.ratio === b.ratio;
}
