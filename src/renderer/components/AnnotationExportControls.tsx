import { useEffect, useRef, useState } from "react";
import { annotationExportMessage, type AnnotationExportDestination, type AnnotationExportResult } from "@/annotation/export";
import type { DisplayInfo } from "@/shared/contract";

export default function AnnotationExportControls({ displays }: { displays: readonly DisplayInfo[] }) {
  const [chosen, setChosen] = useState<number | null>(null);
  const display = displays.find(item => item.id === chosen) ?? displays[0];
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AnnotationExportResult | null>(null);
  const lock = useRef(false);
  const epoch = useRef(0);
  useEffect(() => { epoch.current += 1; return () => { epoch.current += 1; }; }, []);
  async function run(destination: AnnotationExportDestination) {
    if (lock.current || !display || typeof miniCast === "undefined") return;
    lock.current = true;
    setBusy(true);
    setResult(null);
    const generation = epoch.current;
    try {
      const next = await miniCast.exportAnnotation({ displayId: display.id, destination });
      if (generation === epoch.current) setResult(next);
    } catch {
      if (generation === epoch.current) setResult({ status: "error", reason: "unavailable" });
    } finally {
      lock.current = false;
      if (generation === epoch.current) setBusy(false);
    }
  }
  let message = "";
  if (result?.status === "error") message = annotationExportMessage(result.reason);
  else if (result?.status === "cancelled") message = "저장을 취소했습니다.";
  else if (result) message = `${result.status === "saved" ? `${result.fileName} 저장 완료` : "이미지 복사 완료"} · ${result.width} × ${result.height}px`;
  return (
    <fieldset className="mt-3 space-y-2 rounded-md border p-3" data-annotation-export="">
      <legend className="px-1 text-xs font-medium">판서 이미지 내보내기</legend>
      <label className="flex items-center gap-2 text-xs">
        대상 화면
        <select className="min-w-0 flex-1 rounded border bg-background p-1" aria-label="내보낼 화면" data-export-display=""
          value={display?.id ?? ""} disabled={busy || !display}
          onChange={event => { setChosen(Number(event.target.value)); setResult(null); }}>
          {displays.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        {([['file', 'PNG 저장'], ['clipboard', '이미지 복사']] as const).map(([destination, label]) =>
          <button key={destination} type="button" data-export-action={destination}
            disabled={busy || !display || typeof miniCast === "undefined"} onClick={() => void run(destination)}
            className="rounded bg-muted px-2 py-2 text-xs hover:bg-accent disabled:opacity-40">{label}</button>)}
      </div>
      <p className="text-[11px] text-muted-foreground">선택한 화면 크기의 투명 PNG입니다. 배경 화면·선택 테두리·임시 잉크는 제외합니다. PNG 저장은 조작 모드로 전환합니다.</p>
      <p role="status" aria-live="polite" className="text-xs" data-export-status={busy ? "running" : result?.status ?? "idle"}>
        {busy ? "판서 이미지를 내보내는 중입니다…" : message}
      </p>
    </fieldset>
  );
}
