import type { WebContents } from "electron";
import { readFileSync } from "node:fs";

/** Execute the compiled production planner/painter inside Chromium, not a mocked Canvas. */
export async function verifyDirtyCanvasRendering(contents: WebContents) {
  await contents.executeJavaScript(`document.fonts.load('400 28px "Pretendard"', '한글 ABC').then(() => true)`);
  const source = ["errors", "text", "history", "shape-geometry", "render-plan", "canvas-renderer"]
    .map((name) =>
      readFileSync(new URL(`../../annotation/${name}.js`, import.meta.url), "utf8")
        .replace(/^import .* from ["'][^"']+["'];?\r?\n/gm, "")
        .replace(/^export /gm, ""),
    )
    .join("\n");
  const result = await contents.executeJavaScript(`(() => {
    try {
      ${source}
      const ratios = [1, 1.25, 1.5, 2, 2.5];
      let comparisons = 0;
      let highlighterStrokes = 0;
      const kinds = { full: 0, append: 0, dirty: 0, none: 0 };
      for (const ratio of ratios) {
        const optimized = document.createElement('canvas');
        const reference = document.createElement('canvas');
        optimized.width = reference.width = Math.round(100 * ratio);
        optimized.height = reference.height = Math.round(80 * ratio);
        const a = optimized.getContext('2d', { willReadFrequently: true });
        const b = reference.getContext('2d', { willReadFrequently: true });
        if (!a || !b) throw new Error('Missing test Canvas context');
        let previous = null;
        let elements = [];
        let seed = 0x519ba;
        const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
        const makeStroke = (id) => {
          const highlighter = ((random() >>> 16) & 1) === 0;
          if (highlighter) highlighterStrokes++;
          return { id, tool: highlighter ? 'highlighter' : 'pen', opacity: highlighter ? 0.35 : 1,
            color: ['#FF0000', '#007AFF', '#FFD60A'][(random() >>> 8) % 3], width: 1 + (random() % 160) / 10,
            points: Array.from({ length: 1 + random() % 6 }, () => ({ x: (random() % 1300) / 10 - 15, y: (random() % 1100) / 10 - 15 })) };
        };
        const compare = (label, force = false) => {
          const next = { displayId: 1, viewportWidth: 100, viewportHeight: 80,
            canvasWidth: optimized.width, canvasHeight: optimized.height, pixelRatio: ratio, elements };
          const plan = paintCommittedAnnotations(a, force ? null : previous, next);
          kinds[plan.kind]++;
          b.setTransform(1, 0, 0, 1, 0, 0);
          b.clearRect(0, 0, reference.width, reference.height);
          b.setTransform(ratio, 0, 0, ratio, 0, 0);
          for (const stroke of elements) drawAnnotationElement(b, stroke);
          const actual = a.getImageData(0, 0, optimized.width, optimized.height).data;
          const expected = b.getImageData(0, 0, reference.width, reference.height).data;
          for (let i = 0; i < actual.length; i++) if (actual[i] !== expected[i])
            throw new Error('Dirty Canvas differs from full reference: ' + JSON.stringify({ ratio, label, channel: i, actual: actual[i], expected: expected[i], kind: plan.kind, clear: plan.clear, before: previous?.elements, after: elements }));
          comparisons++;
          previous = next;
        };
        compare('initial');
        const bottom = { id: 'bottom', tool: 'highlighter', opacity: 0.35, color: '#FFD60A', width: 14.5, points: [{ x: -10, y: 30.25 }, { x: 110, y: 30.25 }] };
        const local = { id: 'local', tool: 'pen', opacity: 1, color: '#FF0000', width: 3, points: [{ x: 48, y: 26 }, { x: 52, y: 38 }] };
        const top = { id: 'top', tool: 'highlighter', opacity: 0.35, color: '#007AFF', width: 11, points: [{ x: 0, y: 12 }, { x: 100, y: 57 }] };
        elements = [bottom, local, top]; compare('overlapping-alpha');
        elements = [bottom, top]; compare('local-alpha-erase');
        elements = [bottom, local, top]; compare('local-alpha-undo');
        elements = [top, local, bottom]; compare('alpha-reorder');
        elements = []; compare('alpha-clear');
        const shapeSet = ['line', 'arrow', 'rectangle', 'ellipse'].map((tool, index) => ({
          id: tool, tool, points: [{x:5.25+index,y:8.75}, {x:91.5,y:66.25-index}], color:'#007AFF', width:3.5, opacity:1,
        }));
        const textElement = createTextElement(a, 'text', {text:'한글 ABC\\n둘째 줄',fontSize:18}, {x:4.25,y:6.5}, '#1478AF');
        elements = [bottom, ...shapeSet, textElement, top]; compare('mixed-shapes-and-text');
        for (const element of [...shapeSet, textElement]) {
          const savedElements = elements;
          elements = elements.filter(candidate => candidate !== element); compare('remove-' + element.tool);
          elements = savedElements; compare('restore-' + element.tool);
        }
        for (const moved of [...shapeSet, textElement, bottom, top]) {
          const saved = elements;
          elements = elements.map(element => element.id === moved.id ? { ...element,
            points: element.points.map(point => ({ x: point.x + 17.25, y: point.y - 11.5 })) } : element);
          compare('move-' + moved.tool);
          elements = saved; compare('undo-move-' + moved.tool);
        }
        // Exercise the actual resize helper, including text overhang, alpha and
        // same-ID dirty invalidation at five backing-store ratios.
        for (const item of [...shapeSet, textElement, bottom, top]) {
          for (const [sx, sy] of [[1.3, 0.7], [0.6, 1.4], [1.25, 1.25]]) {
            const saved = elements;
            elements = elements.map(element => element.id === item.id
              ? resizeAnnotationElement(element, { x: 30.25, y: 20.75 }, sx, sy) : element);
            compare('resize-' + item.tool + '-' + sx + '-' + sy);
            const resized = elements;
            elements = saved; compare('undo-resize-' + item.tool);
            elements = resized; compare('redo-resize-' + item.tool);
            elements = saved; compare('restore-resize-' + item.tool);
          }
        }
        elements = []; compare('mixed-clear');
        for (let i = 0; i < 80; i++) {
          const saved = elements;
          if (i % 5 === 0 && elements.length) { const removedIndex = random() % elements.length; elements = elements.filter((_, j) => j !== removedIndex); }
          else if (i % 5 === 1 && elements.length > 1) elements = [...elements].reverse();
          else if (i % 5 === 2 && elements.length) elements = [makeStroke(elements[0].id), ...elements.slice(1)];
          else elements = [...elements, makeStroke('s-' + i)];
          compare('edit-' + i);
          if (i % 7 === 0) { const edited = elements; elements = saved; compare('undo-' + i); elements = edited; compare('redo-' + i); }
          if (i % 13 === 0) compare('forced-reset-' + i, true);
        }
        elements = []; compare('clear'); compare('unchanged');
      }
      if (!kinds.dirty || !kinds.append || !kinds.none || !highlighterStrokes)
        throw new Error('Canvas scenarios did not cover all plans and alpha elements');
      return { success: true, exactPixelComparisons: comparisons, ratios, kinds, highlighterStrokes };
    } catch (error) {
      return { success: false, error: String(error?.stack ?? error) };
    }
  })()`);
  if (!result.success) throw new Error(`Canvas reference regression: ${result.error}`);
  return result;
}
