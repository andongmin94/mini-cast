import { useEffect, useRef, useState } from "react";
import {
  MAX_ANNOTATION_TEXT_LENGTH,
  MAX_ANNOTATION_TEXT_LINES,
  readAnnotationTextDraft,
  type AnnotationTextDraft,
} from "@/annotation/text";

interface Props {
  draft: AnnotationTextDraft | null;
  onPrepare(draft: AnnotationTextDraft): Promise<boolean | string>;
  onCancel?(): void;
}

/** Editing stays in the focusable controller, not the click-through desktop window. */
export default function AnnotationTextComposer({ draft, onPrepare, onCancel }: Props) {
  const editing = Boolean(onCancel);
  const [text, setText] = useState(draft?.text ?? "");
  const [fontSize, setFontSize] = useState(draft?.fontSize ?? 28);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const composing = useRef(false);
  const root = useRef<HTMLFormElement>(null);
  const alive = useRef(true);
  const valid = readAnnotationTextDraft({ text, fontSize });

  useEffect(() => {
    alive.current = true;
    const synchronizeFocus = () => {
      if (typeof miniCast !== "undefined") {
        miniCast.setAnnotationTextEditing(
          root.current?.contains(document.activeElement) ?? false,
        );
      }
    };
    window.addEventListener("focus", synchronizeFocus);
    return () => {
      window.removeEventListener("focus", synchronizeFocus);
      alive.current = false;
      if (typeof miniCast !== "undefined") miniCast.setAnnotationTextEditing(false);
    };
  }, []);

  useEffect(() => {
    if (editing) root.current?.scrollIntoView({ block: "nearest" });
  }, [editing]);

  async function prepare() {
    if (!valid || busy || composing.current) return;
    setBusy(true);
    setMessage(null);
    try {
      const accepted = await onPrepare(valid);
      if (!alive.current) return;
      setMessage(typeof accepted === "string" ? accepted : accepted
        ? (editing ? "텍스트를 수정했습니다." : "화면의 원하는 위치를 클릭해 배치하세요.")
        : "텍스트를 준비하지 못했습니다. 앱 연결을 확인해 주세요.");
      if (accepted === true) {
        const focused = document.activeElement;
        if (focused instanceof HTMLElement && root.current?.contains(focused)) focused.blur();
      }
    } catch {
      if (alive.current) setMessage("텍스트 준비 요청에 실패했습니다. 다시 시도해 주세요.");
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  return (
    <form
      ref={root}
      data-annotation-text-editor=""
      className="bg-muted space-y-2 rounded-md p-3"
      onSubmit={(event) => { event.preventDefault(); void prepare(); }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || composing.current) return;
        if (event.key === "Escape" && typeof miniCast !== "undefined") {
          event.preventDefault();
          if (!busy) {
            if (onCancel) onCancel();
            else miniCast.setAnnotationTool("pass-through");
          }
        }
      }}
      onFocus={() => {
        if (typeof miniCast !== "undefined") miniCast.setAnnotationTextEditing(true);
      }}
      onBlur={(event) => {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
        if (typeof miniCast !== "undefined") miniCast.setAnnotationTextEditing(false);
      }}
    >
      <label htmlFor="annotation-text-content" className="block text-xs font-medium">{editing ? "선택한 텍스트 수정" : "배치할 텍스트"}</label>
      <textarea
        id="annotation-text-content"
        value={text}
        readOnly={busy}
        autoFocus={editing}
        maxLength={MAX_ANNOTATION_TEXT_LENGTH}
        rows={3}
        placeholder="설명이나 제목을 입력하세요"
        className="bg-background w-full resize-y select-text rounded border px-2 py-1 text-sm"
        onChange={(event) => { setText(event.target.value); setMessage(null); }}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={() => { composing.current = false; }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || composing.current) return;
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            void prepare();
          }
        }}
      />
      <label htmlFor="annotation-text-size" className="flex items-center gap-2 text-xs">
        글자 크기
        <input id="annotation-text-size" type="range" min={12} max={96} step={1}
          value={fontSize} disabled={busy} className="min-w-0 flex-1"
          onChange={(event) => setFontSize(Number(event.target.value))} />
        <span>{fontSize}px</span>
      </label>
      <p className="text-muted-foreground text-[11px]">
        최대 {MAX_ANNOTATION_TEXT_LENGTH}자 · {MAX_ANNOTATION_TEXT_LINES}줄 · Enter 줄바꿈 · Ctrl+Enter {editing ? "수정 적용" : "배치 준비"}
      </p>
      <button type="submit" data-annotation-text-prepare="" disabled={!valid || busy}
        className="bg-primary text-primary-foreground w-full rounded px-3 py-2 text-xs disabled:opacity-40">
        {busy ? "처리 중…" : editing ? "수정 적용" : "화면에 배치"}
      </button>
      {onCancel && <button type="button" data-annotation-text-cancel="" disabled={busy}
        className="w-full rounded border px-3 py-2 text-xs disabled:opacity-40" onClick={onCancel}>수정 취소</button>}
      {message && <p role="status" className="text-xs">{message}</p>}
      {text.trim() && !valid && <p role="alert" className="text-destructive text-xs">글자 수·줄 수 또는 허용되지 않는 제어문자를 확인해 주세요.</p>}
    </form>
  );
}
