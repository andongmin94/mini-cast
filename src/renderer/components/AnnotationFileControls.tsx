import { useEffect, useRef, useState } from "react";
import { annotationFileMessage, type AnnotationFileRequest, type AnnotationFileResult } from "@/annotation/document-file";
import type { DisplayInfo } from "@/shared/contract";

export default function AnnotationFileControls({ displays }: { displays: readonly DisplayInfo[] }) {
  const [chosen, setChosen] = useState<number | null>(null);
  const display = displays.find(item => item.id === chosen) ?? displays[0];
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AnnotationFileResult | null>(null);
  const locked = useRef(false);
  const epoch = useRef(0);
  useEffect(() => { epoch.current += 1; return () => { epoch.current += 1; }; }, []);
  async function run(action: AnnotationFileRequest["action"]) {
    if (locked.current || !display || typeof miniCast === "undefined") return;
    locked.current = true;
    setBusy(true);
    setResult(null);
    const generation = epoch.current;
    try {
      const next = await miniCast.annotationFile({ displayId: display.id, action });
      if (generation === epoch.current) setResult(next);
    } catch {
      if (generation === epoch.current) setResult({ status: "error", reason: "unavailable" });
    } finally {
      locked.current = false;
      if (generation === epoch.current) setBusy(false);
    }
  }
  let message = "";
  if (result?.status === "error") message = annotationFileMessage(result.reason);
  else if (result?.status === "cancelled") message = "취소했습니다. 현재 판서는 그대로 유지됩니다.";
  else if (result) message = `${result.fileName} · ${result.elements}개 객체 ${result.status === "saved" ? "저장 완료" : result.changed ? "열기 완료 (실행취소 가능)" : "열기 완료 (동일한 판서)"}`;
  return (
    <fieldset className="mt-3 space-y-2 rounded-md border p-3" data-annotation-files="">
      <legend className="px-1 text-xs font-medium">편집 가능한 판서 파일</legend>
      <label className="flex items-center gap-2 text-xs">
        대상 화면
        <select className="min-w-0 flex-1 rounded border bg-background p-1" aria-label="판서 파일 대상 화면"
          data-file-display="" value={display?.id ?? ""} disabled={busy || !display}
          onChange={event => { setChosen(Number(event.target.value)); setResult(null); }}>
          {displays.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        {([['save', '판서 파일 저장'], ['open', '판서 파일 열기']] as const).map(([action, label]) =>
          <button key={action} type="button" data-file-action={action} disabled={busy || !display || typeof miniCast === "undefined"}
            onClick={() => void run(action)} className="rounded bg-muted px-2 py-2 text-xs hover:bg-accent disabled:opacity-40">{label}</button>)}
      </div>
      <p className="text-[11px] text-muted-foreground">.minicast 파일은 객체를 다시 편집할 수 있습니다. 열기는 선택한 화면만 교체하며, 다른 화면 크기에는 비율을 유지해 맞춥니다. 자동 저장은 하지 않습니다.</p>
      <p role="status" aria-live="polite" className="text-xs" data-file-status={busy ? "running" : result?.status ?? "idle"}
        data-file-reason={result?.status === "error" ? result.reason : ""}>
        {busy ? "판서 파일을 처리하는 중입니다…" : message}
      </p>
    </fieldset>
  );
}
