import AnnotationTextComposer from "./AnnotationTextComposer";
import { isTransientAnnotationTool } from "@/shared/contract";
import type { AnnotationTextDraft } from "@/annotation/text";
import {
  Eraser,
  Minus,
  ArrowUpRight,
  Square,
  Circle,
  Type,
  Highlighter,
  Crosshair,
  Timer,
  MousePointer2,
  PenLine,
  Redo2,
  Trash2,
  Undo2,
} from "lucide-react";

import { Label } from "@/renderer/components/ui/label";
import { Slider } from "@/renderer/components/ui/slider";
import type {
  AnnotationCommand,
  AnnotationPreferences,
  AnnotationTool,
} from "@/shared/contract";

interface AnnotationControlsProps {
  textDraft: AnnotationTextDraft | null;
  onPrepareText(draft: AnnotationTextDraft): Promise<boolean>;
  tool: AnnotationTool;
  settings: AnnotationPreferences;
  onToolChange(tool: AnnotationTool): void;
  onCommand(command: AnnotationCommand): void;
  onSettingChange<K extends keyof AnnotationPreferences>(
    key: K,
    value: AnnotationPreferences[K],
  ): void;
  unavailableShortcuts: readonly string[];
  canUndo: boolean;
  canRedo: boolean;
}

const TOOL_OPTIONS = [
  {
    tool: "pass-through",
    label: "조작",
    shortcut: "Alt+Shift+1",
    Icon: MousePointer2,
  },
  { tool: "select", label: "선택", shortcut: "클릭 · Shift 추가 선택 · 드래그 이동", Icon: MousePointer2 },
  { tool: "pen", label: "펜", shortcut: "Alt+Shift+3", Icon: PenLine },
  {
    tool: "highlighter",
    label: "형광펜",
    shortcut: "Alt+Shift+4",
    Icon: Highlighter,
  },
  {
    tool: "eraser",
    label: "지우개",
    shortcut: "Alt+Shift+5",
    Icon: Eraser,
  },
  { tool: "line", label: "직선", shortcut: "드래그 · Shift 45°", Icon: Minus },
  { tool: "arrow", label: "화살표", shortcut: "드래그 · Shift 45°", Icon: ArrowUpRight },
  { tool: "rectangle", label: "사각형", shortcut: "드래그 · Shift 정사각형", Icon: Square },
  { tool: "ellipse", label: "타원", shortcut: "드래그 · Shift 원", Icon: Circle },
  { tool: "text", label: "텍스트", shortcut: "입력 후 클릭 배치", Icon: Type },
  { tool: "laser", label: "레이저", shortcut: "포인터 이동 · Escape 종료", Icon: Crosshair },
  { tool: "fading-ink", label: "사라지는 잉크", shortcut: "놓은 뒤 2초 유지 · 0.7초 소멸", Icon: Timer },
] as const;

export default function AnnotationControls({
  textDraft,
  onPrepareText,
  tool,
  settings,
  onToolChange,
  onCommand,
  onSettingChange,
  unavailableShortcuts,
  canUndo,
  canRedo,
}: AnnotationControlsProps) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-2">
        {TOOL_OPTIONS.map(({ tool: option, label, shortcut, Icon }) => (
          <button
            key={option}
            type="button"
            data-annotation-tool={option}
            aria-pressed={tool === option}
            title={`${label} (${shortcut})`}
            onClick={() => onToolChange(option)}
            className={`flex h-14 flex-col items-center justify-center rounded-md text-xs transition-colors ${tool === option
              ? "bg-primary text-primary-foreground"
              : "bg-muted hover:bg-accent"
              }`}
          >
            <Icon className="mb-1 size-4" />
            {label}
          </button>
        ))}
      </div>

      <fieldset className="bg-muted space-y-2 rounded-md p-3">
        <legend className="px-1 text-xs font-medium">사각형·타원 채우기</legend>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" data-annotation-shape-fill="" checked={settings.annotationShapeFillEnabled}
            onChange={event => onSettingChange("annotationShapeFillEnabled", event.target.checked)} />
          새 사각형·타원 내부 채우기
        </label>
        <label className="flex items-center justify-between gap-2 text-xs">
          채우기 색상
          <input type="color" data-annotation-shape-fill-color="" value={settings.annotationShapeFillColor}
            onChange={event => onSettingChange("annotationShapeFillColor", event.target.value)}
            className="color-picker rounded-md px-1 py-0.5" />
        </label>
        <p className="text-muted-foreground text-[11px]">기존 도형은 선택 후 ‘채우기 적용’ 또는 ‘채우기 제거’를 누르세요. 윤곽선 색상은 유지됩니다.</p>
      </fieldset>

      {isTransientAnnotationTool(tool) && <p className="text-muted-foreground rounded bg-muted p-2 text-xs" data-transient-help="">
        {tool === "laser" ? "레이저는 흔적을 남기지 않습니다." : "펜 색상·굵기로 그리며, 펜을 놓은 뒤 2초 후 서서히 사라집니다."}
        {" "}임시 표시 중에는 아래 프로그램 클릭을 차단합니다. Escape로 조작 모드에 복귀합니다.
        {" "}실행취소는 진행 중 입력만 취소하고, 임시 지우기는 모든 화면의 임시 표시만 지웁니다. 기존 판서·Redo는 유지됩니다.
      </p>}
      {tool === "text" && <AnnotationTextComposer draft={textDraft} onPrepare={onPrepareText} />}
      <p className="text-muted-foreground text-center text-[11px]">
        판서 중에는 커서 하이라이트와 클릭 효과가 자동으로 숨겨집니다.
      </p>

      {unavailableShortcuts.length > 0 && (
        <p className="text-destructive text-center text-[11px]">
          사용 중인 단축키: {unavailableShortcuts.join(", ")}
        </p>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="flex items-center justify-center gap-3">
          <Label htmlFor="annotation-pen-color">그리기 색상</Label>
          <input
            id="annotation-pen-color"
            type="color"
            value={settings.annotationPenColor}
            onChange={(event) =>
              onSettingChange("annotationPenColor", event.target.value)
            }
            className="color-picker rounded-md px-1 py-0.5"
          />
        </div>
        <div className="flex items-center justify-center gap-3">
          <Label htmlFor="annotation-highlighter-color">형광펜</Label>
          <input
            id="annotation-highlighter-color"
            type="color"
            value={settings.annotationHighlighterColor}
            onChange={(event) =>
              onSettingChange("annotationHighlighterColor", event.target.value)
            }
            className="color-picker rounded-md px-1 py-0.5"
          />
        </div>
      </div>

      <div className="space-y-1">
        <AnnotationSlider
          label="펜·도형 굵기"
          value={settings.annotationPenWidth}
          min={1}
          max={24}
          text={`${settings.annotationPenWidth}px`}
          onChange={(value) => onSettingChange("annotationPenWidth", value)}
        />
        <AnnotationSlider
          label="형광펜 굵기"
          value={settings.annotationHighlighterWidth}
          min={4}
          max={64}
          text={`${settings.annotationHighlighterWidth}px`}
          onChange={(value) =>
            onSettingChange("annotationHighlighterWidth", value)
          }
        />
        <AnnotationSlider
          label="지우개 크기"
          value={settings.annotationEraserWidth}
          min={8}
          max={80}
          text={`${settings.annotationEraserWidth}px`}
          onChange={(value) => onSettingChange("annotationEraserWidth", value)}
        />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          data-annotation-command="undo"
          disabled={!canUndo}
          onClick={() => onCommand("undo")}
          className="bg-muted hover:bg-accent flex h-8 items-center justify-center rounded-md text-xs disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Undo2 className="mr-1 size-4" />
          {isTransientAnnotationTool(tool) ? "입력 취소" : "실행취소"}
        </button>
        <button
          type="button"
          data-annotation-command="redo"
          disabled={!canRedo}
          onClick={() => onCommand("redo")}
          className="bg-muted hover:bg-accent flex h-8 items-center justify-center rounded-md text-xs disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Redo2 className="mr-1 size-4" />
          다시실행
        </button>
        <button
          type="button"
          data-annotation-command="clear"
          onClick={() => onCommand("clear")}
          className="bg-destructive flex h-8 items-center justify-center rounded-md text-xs text-white hover:opacity-90"
        >
          <Trash2 className="mr-1 size-4" />
          {isTransientAnnotationTool(tool) ? "임시 지우기" : "화면지우기"}
        </button>
      </div>
    </div>
  );
}

interface AnnotationSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  text: string;
  onChange(value: number): void;
}

function AnnotationSlider({
  label,
  value,
  min,
  max,
  text,
  onChange,
}: AnnotationSliderProps) {
  return (
    <div className="flex items-center space-x-2 pb-2">
      <Label className="whitespace-nowrap">{label}</Label>
      <Slider
        min={min}
        max={max}
        step={1}
        value={[value]}
        onValueChange={(next) => onChange(next[0])}
      />
      <span className="whitespace-nowrap">{text}</span>
    </div>
  );
}
