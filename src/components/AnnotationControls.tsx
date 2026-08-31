import {
  Eraser,
  Highlighter,
  MousePointer2,
  PenLine,
  Redo2,
  Trash2,
  Undo2,
} from "lucide-react";

import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import type {
  AnnotationCommand,
  AnnotationPreferences,
  AnnotationTool,
} from "@/electron/contract";

interface AnnotationControlsProps {
  tool: AnnotationTool;
  settings: AnnotationPreferences;
  onToolChange(tool: AnnotationTool): void;
  onCommand(command: AnnotationCommand): void;
  onSettingChange<K extends keyof AnnotationPreferences>(
    key: K,
    value: AnnotationPreferences[K],
  ): void;
  unavailableShortcuts: readonly string[];
}

const TOOL_OPTIONS = [
  {
    tool: "pass-through",
    label: "조작",
    shortcut: "Alt+Shift+1",
    Icon: MousePointer2,
  },
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
] as const;

export default function AnnotationControls({
  tool,
  settings,
  onToolChange,
  onCommand,
  onSettingChange,
  unavailableShortcuts,
}: AnnotationControlsProps) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-2">
        {TOOL_OPTIONS.map(({ tool: option, label, shortcut, Icon }) => (
          <button
            key={option}
            type="button"
            title={`${label} (${shortcut})`}
            onClick={() => onToolChange(option)}
            className={`flex h-14 flex-col items-center justify-center rounded-md text-xs transition-colors ${
              tool === option
                ? "bg-primary text-primary-foreground"
                : "bg-muted hover:bg-accent"
            }`}
          >
            <Icon className="mb-1 size-4" />
            {label}
          </button>
        ))}
      </div>

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
          <Label htmlFor="annotation-pen-color">펜 색상</Label>
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
          label="펜 굵기"
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
          onClick={() => onCommand("undo")}
          className="bg-muted hover:bg-accent flex h-8 items-center justify-center rounded-md text-xs"
        >
          <Undo2 className="mr-1 size-4" />
          실행취소
        </button>
        <button
          type="button"
          onClick={() => onCommand("redo")}
          className="bg-muted hover:bg-accent flex h-8 items-center justify-center rounded-md text-xs"
        >
          <Redo2 className="mr-1 size-4" />
          다시실행
        </button>
        <button
          type="button"
          onClick={() => onCommand("clear")}
          className="bg-destructive flex h-8 items-center justify-center rounded-md text-xs text-white hover:opacity-90"
        >
          <Trash2 className="mr-1 size-4" />
          화면지우기
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
