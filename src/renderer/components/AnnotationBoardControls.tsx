import { useEffect, useRef, useState } from "react";
import {
  ANNOTATION_BOARD_MODES, newerAnnotationBoards,
  type AnnotationBoardMode, type AnnotationBoardSnapshot,
} from "@/annotation/board";
import type { DisplayInfo } from "@/shared/contract";

const LABELS: Record<AnnotationBoardMode, string> = {
  transparent: "화면 판서", white: "화이트보드", black: "블랙보드",
};

export default function AnnotationBoardControls({ displays }: { displays: readonly DisplayInfo[] }) {
  const [chosen, setChosen] = useState<number | null>(null);
  const [state, setState] = useState<AnnotationBoardSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const lock = useRef(false);
  const epoch = useRef(0);
  const display = displays.find(item => item.id === chosen) ?? displays[0];
  const selected = state?.displays.find(item => item.displayId === display?.id);

  useEffect(() => {
    if (typeof miniCast === "undefined") return;
    const generation = ++epoch.current;
    const adopt = (next: AnnotationBoardSnapshot) => {
      if (epoch.current === generation) setState(current => newerAnnotationBoards(current, next));
    };
    const stop = miniCast.onAnnotationBoardsUpdated(adopt);
    void miniCast.getAnnotationBoards().then(adopt).catch(() => {
      if (epoch.current === generation) setNotice("배경 상태를 확인하지 못했습니다. 판서 탭을 다시 열어 주세요.");
    });
    return () => { epoch.current += 1; stop(); };
  }, []);

  async function apply(mode: AnnotationBoardMode) {
    if (!display || !selected || lock.current || typeof miniCast === "undefined") return;
    lock.current = true;
    setBusy(true);
    setNotice("");
    const generation = epoch.current;
    try {
      const result = await miniCast.setAnnotationBoard({ displayId: display.id, mode });
      if (epoch.current !== generation) return;
      if (result.accepted) {
        setState(current => newerAnnotationBoards(current, result.state));
        setNotice(`${display.name}: ${LABELS[mode]} 적용`);
      } else setNotice(result.reason === "busy"
        ? "파일 저장·열기·내보내기를 마친 뒤 배경을 변경하세요."
        : "화면 연결과 텍스트 편집 상태를 확인한 뒤 다시 시도하세요.");
    } catch {
      if (epoch.current === generation) setNotice("배경 변경 결과를 확인하지 못했습니다. 판서는 그대로 유지됩니다.");
    } finally {
      lock.current = false;
      if (epoch.current === generation) setBusy(false);
    }
  }

  return (
    <fieldset className="mt-3 space-y-2 rounded-md border p-3" data-annotation-board-controls="">
      <legend className="px-1 text-xs font-medium">판서 배경</legend>
      <label className="flex items-center gap-2 text-xs">
        대상 화면
        <select aria-label="배경을 바꿀 화면" data-board-display="" value={display?.id ?? ""}
          disabled={busy || !display} className="min-w-0 flex-1 rounded border bg-background p-1"
          onChange={event => { setChosen(Number(event.target.value)); setNotice(""); }}>
          {displays.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <div className="grid grid-cols-3 gap-2" role="group" aria-label="판서 배경 선택">
        {ANNOTATION_BOARD_MODES.map(mode => (
          <button key={mode} type="button" data-board-mode={mode} aria-pressed={selected?.mode === mode}
            disabled={busy || !selected || typeof miniCast === "undefined"} onClick={() => void apply(mode)}
            className={`rounded border px-1 py-2 text-xs disabled:opacity-40 ${selected?.mode === mode ? "border-primary bg-primary text-primary-foreground" : "bg-muted hover:bg-accent"}`}>
            {LABELS[mode]}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">기존 판서는 유지하고 배경만 바꿉니다. Escape로 배경을 숨기며 다시 판서하면 복원됩니다. 배경은 PNG·판서 파일에 저장하지 않습니다.</p>
      <p className="text-[11px] text-muted-foreground">펜·글자 색은 자동 변경하지 않습니다. 배경과 구분되는 색을 선택하세요.</p>
      <p role="status" aria-live="polite" className="text-xs" data-board-status={busy ? "running" : "idle"}>
        {busy ? "배경을 바꾸는 중입니다…" : notice}
      </p>
    </fieldset>
  );
}
