import { useEffect, useRef, useState } from "react";
import type { AnnotationTextEditSession } from "@/annotation/text-edit";
import { annotationFailureMessage } from "@/annotation/errors";
import { annotationTextFont, createTextElement, type AnnotationTextDraft } from "@/annotation/text";
import AnnotationTextComposer from "./AnnotationTextComposer";

/** Reuse the focusable controller composer; no input window is placed on the desktop. */
export default function AnnotationExistingTextEditor() {
  const [session, setSession] = useState<AnnotationTextEditSession | null>(null);
  const current = useRef<AnnotationTextEditSession | null>(null);
  useEffect(() => {
    if (typeof miniCast === "undefined") return;
    let alive = true;
    let pushed = false;
    const adopt = (next: AnnotationTextEditSession | null) => {
      if (!alive) return;
      current.current = next;
      setSession(next);
    };
    const stop = miniCast.onAnnotationTextEdit(next => { pushed = true; adopt(next); });
    void miniCast.getAnnotationTextEdit().then(next => {
      if (!pushed) adopt(next);
    }).catch(error => console.error("Cannot read text edit session:", error));
    return () => { alive = false; current.current = null; stop(); };
  }, []);

  if (!session) return null;
  const editing = session;
  async function save(draft: AnnotationTextDraft): Promise<boolean | string> {
    try {
      const faces = await document.fonts.load(annotationTextFont(draft.fontSize), "한글 ABC");
      if (!faces.length) return "판서 글꼴을 불러오지 못했습니다. 기존 텍스트는 바꾸지 않았습니다.";
      if (current.current?.id !== editing.id) return "취소되었거나 다른 편집으로 바뀐 요청입니다.";
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) return "글자 크기를 측정하지 못했습니다. 기존 텍스트는 유지됩니다.";
      const measured = createTextElement(context, editing.element.id, draft, { x: 0, y: 0 }, editing.element.color);
      const result = await miniCast.saveAnnotationTextEdit(editing.id, {
        text: measured.text, fontSize: measured.fontSize, box: measured.box,
      });
      if (!result.accepted) return annotationFailureMessage(result.reason) ?? "텍스트 변경을 적용하지 못했습니다.";
      if (current.current?.id === editing.id) { current.current = null; setSession(null); }
      return true;
    } catch {
      // Do not blindly retry a save whose acknowledgement may have been lost.
      try {
        const next = await miniCast.getAnnotationTextEdit();
        if (current.current?.id === editing.id) { current.current = next; setSession(next); }
      } catch { /* Keep the user's draft until they explicitly cancel or retry. */ }
      return "변경 결과를 확인하지 못했습니다. 기존 내용을 확인한 뒤 다시 시도해 주세요.";
    }
  }
  return <section data-annotation-existing-text-editor="" className="mb-3">
    <AnnotationTextComposer key={editing.id} draft={editing.element} onPrepare={save}
      onCancel={() => miniCast.cancelAnnotationTextEdit(editing.id)} />
  </section>;
}
