import { sameAnnotationInputViewport, type AnnotationInputViewport } from "@/annotation/viewport";

/** Observe CSS size and pure DPR changes, without cancelling on redundant observer notifications. */
export function observeAnnotationViewport(canvas: HTMLCanvasElement, changed: () => void): () => void {
  let previous: AnnotationInputViewport | null = null;
  let query: MediaQueryList | null = null;
  let disposed = false;
  const refresh = () => {
    if (disposed) return;
    const next = { width: canvas.clientWidth, height: canvas.clientHeight, ratio: window.devicePixelRatio || 1 };
    const ratioChanged = previous?.ratio !== next.ratio;
    if (!sameAnnotationInputViewport(previous, next)) {
      previous = next;
      changed();
    }
    if (ratioChanged) {
      query?.removeEventListener("change", refresh);
      query = window.matchMedia(`(resolution: ${next.ratio}dppx)`);
      query.addEventListener("change", refresh);
    }
  };
  const observer = new ResizeObserver(refresh);
  observer.observe(canvas);
  window.addEventListener("resize", refresh);
  refresh();
  return () => {
    disposed = true;
    observer.disconnect();
    window.removeEventListener("resize", refresh);
    query?.removeEventListener("change", refresh);
  };
}
