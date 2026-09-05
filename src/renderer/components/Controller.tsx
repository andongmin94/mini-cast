import { useEffect, useState } from "react";

import { Keyboard, MousePointer2, PenLine } from "lucide-react";

import AnnotationControls from "@/renderer/components/AnnotationControls";
import TitleBar from "@/renderer/components/TitleBar";
import { colorForEditor, rgbaFromEditor } from "@/shared/color";
import { Label } from "@/renderer/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/renderer/components/ui/select";
import { Slider } from "@/renderer/components/ui/slider";
import { Switch } from "@/renderer/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/renderer/components/ui/tabs";
import type {
  AnnotationCommand,
  AnnotationPreferences,
  AnnotationState,
  AnnotationTool,
  DisplayInfo,
  KeyDisplayPosition,
  OverlaySettings,
  SettingsSaveStatus,
} from "@/shared/contract";
import { DEFAULT_OVERLAY_SETTINGS } from "@/shared/contract";

interface Settings extends AnnotationPreferences {
  cursorFillColor: string;
  cursorFillOpacity: number;
  cursorStrokeColor: string;
  cursorStrokeOpacity: number;
  cursorSize: number;
  cursorStrokeSize: number;
  showCursorHighlight: boolean;
  keyDisplayId: number;
  keyDisplayDuration: number;
  keyDisplayFontSize: number;
  keyDisplayBackgroundColor: string;
  keyDisplayBackgroundOpacity: number;
  keyDisplayTextColor: string;
  keyDisplayPosition: KeyDisplayPosition;
  showKeyDisplay: boolean;
}

function fromOverlaySettings(settings: OverlaySettings): Settings {
  const fill = colorForEditor(
    settings.cursorFillColor,
    DEFAULT_OVERLAY_SETTINGS.cursorFillColor,
  );
  const stroke = colorForEditor(
    settings.cursorStrokeColor,
    DEFAULT_OVERLAY_SETTINGS.cursorStrokeColor,
  );
  const background = colorForEditor(
    settings.keyDisplayBackgroundColor,
    DEFAULT_OVERLAY_SETTINGS.keyDisplayBackgroundColor,
  );

  return {
    cursorFillColor: fill.color,
    cursorFillOpacity: fill.opacity,
    cursorStrokeColor: stroke.color,
    cursorStrokeOpacity: stroke.opacity,
    cursorSize: settings.cursorSize,
    cursorStrokeSize: settings.cursorStrokeSize,
    showCursorHighlight: settings.showCursorHighlight,
    keyDisplayId: settings.keyDisplayId,
    keyDisplayDuration: settings.keyDisplayDuration,
    keyDisplayFontSize: settings.keyDisplayFontSize,
    keyDisplayBackgroundColor: background.color,
    keyDisplayBackgroundOpacity: background.opacity,
    keyDisplayTextColor: settings.keyDisplayTextColor,
    keyDisplayPosition: settings.keyDisplayPosition,
    showKeyDisplay: settings.showKeyDisplay,
    annotationPenColor: settings.annotationPenColor,
    annotationHighlighterColor: settings.annotationHighlighterColor,
    annotationPenWidth: settings.annotationPenWidth,
    annotationHighlighterWidth: settings.annotationHighlighterWidth,
    annotationEraserWidth: settings.annotationEraserWidth,
  };
}

function toOverlaySettings(settings: Settings): OverlaySettings {
  return {
    cursorFillColor: rgbaFromEditor(
      settings.cursorFillColor,
      settings.cursorFillOpacity,
    ),
    cursorStrokeColor: rgbaFromEditor(
      settings.cursorStrokeColor,
      settings.cursorStrokeOpacity,
    ),
    cursorSize: settings.cursorSize,
    cursorStrokeSize: settings.cursorStrokeSize,
    showCursorHighlight: settings.showCursorHighlight,
    keyDisplayId: settings.keyDisplayId,
    keyDisplayDuration: settings.keyDisplayDuration,
    keyDisplayFontSize: settings.keyDisplayFontSize,
    keyDisplayBackgroundColor: rgbaFromEditor(
      settings.keyDisplayBackgroundColor,
      settings.keyDisplayBackgroundOpacity,
    ),
    keyDisplayTextColor: settings.keyDisplayTextColor,
    keyDisplayPosition: settings.keyDisplayPosition,
    showKeyDisplay: settings.showKeyDisplay,
    annotationPenColor: settings.annotationPenColor,
    annotationHighlighterColor: settings.annotationHighlighterColor,
    annotationPenWidth: settings.annotationPenWidth,
    annotationHighlighterWidth: settings.annotationHighlighterWidth,
    annotationEraserWidth: settings.annotationEraserWidth,
  };
}

const DEFAULT_SETTINGS: Settings = fromOverlaySettings(
  DEFAULT_OVERLAY_SETTINGS,
);

export default function Controller() {
  const hasBridge = typeof miniCast !== "undefined";
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [annotationState, setAnnotationState] = useState<AnnotationState>({
    tool: "pass-through",
    unavailableShortcuts: [],
    canUndo: false,
    canRedo: false,
  });
  const [saveStatus, setSaveStatus] = useState<SettingsSaveStatus>({
    state: "saved",
    recovered: false,
  });
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [settingsLoaded, setSettingsLoaded] = useState(!hasBridge);

  useEffect(() => {
    if (!hasBridge) return;

    let active = true;
    void miniCast
      .getSettings()
      .then((saved) => {
        if (!active) return;
        setSettings(fromOverlaySettings(saved));
        setSettingsLoaded(true);
      })
      .catch((error) => console.error("Failed to load settings:", error));
    void miniCast
      .getAnnotationState()
      .then((state) => {
        if (active) setAnnotationState(state);
      })
      .catch((error) =>
        console.error("Failed to load annotation state:", error),
      );

    void miniCast
      .getSettingsSaveStatus()
      .then((status) => {
        if (active) setSaveStatus(status);
      })
      .catch((error) =>
        console.error("Failed to load settings status:", error),
      );
    const stopSaveStatus = miniCast.onSettingsSaveStatus(setSaveStatus);
    const stopAnnotation =
      miniCast.onAnnotationStateUpdated(setAnnotationState);
    return () => {
      active = false;
      stopAnnotation();
      stopSaveStatus();
    };
  }, [hasBridge]);

  useEffect(() => {
    if (!hasBridge) return;
    const unsubscribe = miniCast.onDisplaysUpdated(setDisplays);
    miniCast.requestDisplays();
    return unsubscribe;
  }, [hasBridge]);

  useEffect(() => {
    if (!hasBridge) return;
    return miniCast.onSettingsUpdated((saved) => {
      setSettings(fromOverlaySettings(saved));
      setSettingsLoaded(true);
    });
  }, [hasBridge]);

  useEffect(() => {
    if (hasBridge && settingsLoaded) {
      miniCast.saveSettings(toOverlaySettings(settings));
    }
  }, [hasBridge, settingsLoaded, settings]);

  function set<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  function setAnnotationPreference<K extends keyof AnnotationPreferences>(
    key: K,
    value: AnnotationPreferences[K],
  ) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  function chooseAnnotationTool(tool: AnnotationTool) {
    setAnnotationState((current) => ({ ...current, tool }));
    if (hasBridge) miniCast.setAnnotationTool(tool);
  }

  function sendAnnotationCommand(command: AnnotationCommand) {
    if (hasBridge) miniCast.sendAnnotationCommand(command);
  }

  function reset() {
    if (window.confirm("모든 설정을 초기화하시겠습니까?")) {
      setSettings({
        ...DEFAULT_SETTINGS,
        keyDisplayId: displays[0]?.id ?? DEFAULT_SETTINGS.keyDisplayId,
      });
    }
  }

  return (
    <>
      <TitleBar />
      <div className="pointer-events-auto z-[999] h-[336px] overflow-y-auto p-4">
        {(saveStatus.state === "failed" || saveStatus.recovered) && (
          <div
            role="alert"
            data-settings-status={saveStatus.state}
            className="mb-3 rounded-md border border-amber-500 bg-amber-50 p-3 text-xs text-slate-900"
          >
            {saveStatus.state === "failed" ? (
              <>
                <p>
                  설정을 저장하지 못했습니다. 현재 변경은 앱에서만 적용되며,
                  종료하면 사라질 수 있습니다.
                </p>
                <button
                  type="button"
                  data-settings-retry=""
                  className="mt-2 font-semibold underline"
                  onClick={() => miniCast.retrySettingsSave()}
                >
                  저장 다시 시도
                </button>
              </>
            ) : (
              <>
                <p>설정 파일을 읽을 수 없어 기본 설정으로 초기화했습니다.</p>
                <button
                  type="button"
                  className="mt-2 font-semibold underline"
                  onClick={() => miniCast.acknowledgeSettingsRecovery()}
                >
                  확인
                </button>
              </>
            )}
          </div>
        )}
        <Tabs defaultValue="cursor" className="w-full">
          <TabsList className="z-[999] grid w-full grid-cols-3">
            <TabsTrigger value="cursor">
              <MousePointer2 className="mr-2 h-4 w-4" />
              커서
            </TabsTrigger>
            <TabsTrigger value="keyboard">
              <Keyboard className="mr-2 h-4 w-4" />
              키보드
            </TabsTrigger>
            <TabsTrigger value="annotation" data-mini-cast-tab="annotation">
              <PenLine className="mr-2 h-4 w-4" />
              판서
            </TabsTrigger>
          </TabsList>

          <TabsContent value="cursor" className="space-y-4">
            <div className="flex items-center justify-center space-x-2">
              <Label htmlFor="cursor-highlight">커서 활성화</Label>
              <Switch
                id="cursor-highlight"
                checked={settings.showCursorHighlight}
                onCheckedChange={(value) => set("showCursorHighlight", value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center justify-center gap-4">
                  <Label htmlFor="cursor-fill-color">칠 색상</Label>
                  <input
                    id="cursor-fill-color"
                    type="color"
                    value={settings.cursorFillColor}
                    onChange={(event) =>
                      set("cursorFillColor", event.target.value)
                    }
                    className="color-picker rounded-md px-1 py-0.5"
                  />
                </div>
                <div className="flex items-center justify-center gap-4">
                  <Label htmlFor="cursor-stroke-color">획 색상</Label>
                  <input
                    id="cursor-stroke-color"
                    type="color"
                    value={settings.cursorStrokeColor}
                    onChange={(event) =>
                      set("cursorStrokeColor", event.target.value)
                    }
                    className="color-picker rounded-md px-1 py-0.5"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <SettingSlider
                  label="칠 투명"
                  value={settings.cursorFillOpacity}
                  min={0}
                  max={1}
                  step={0.01}
                  text={settings.cursorFillOpacity.toFixed(2)}
                  onChange={(value) => set("cursorFillOpacity", value)}
                />
                <SettingSlider
                  label="획 투명"
                  value={settings.cursorStrokeOpacity}
                  min={0}
                  max={1}
                  step={0.01}
                  text={settings.cursorStrokeOpacity.toFixed(2)}
                  onChange={(value) => set("cursorStrokeOpacity", value)}
                />
                <SettingSlider
                  label="칠 크기"
                  value={settings.cursorSize}
                  min={10}
                  max={60}
                  step={1}
                  text={`${settings.cursorSize}px`}
                  onChange={(value) => set("cursorSize", value)}
                />
                <SettingSlider
                  label="획 크기"
                  value={settings.cursorStrokeSize}
                  min={0}
                  max={30}
                  step={1}
                  text={`${settings.cursorStrokeSize}px`}
                  onChange={(value) => set("cursorStrokeSize", value)}
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="keyboard" className="space-y-4">
            <div className="flex items-center justify-center space-x-2">
              <Label htmlFor="key-display-active">키보드 활성화</Label>
              <Switch
                id="key-display-active"
                checked={settings.showKeyDisplay}
                onCheckedChange={(value) => set("showKeyDisplay", value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center justify-center gap-4">
                  <Label htmlFor="key-background-color">배경 색상</Label>
                  <input
                    id="key-background-color"
                    type="color"
                    value={settings.keyDisplayBackgroundColor}
                    onChange={(event) =>
                      set("keyDisplayBackgroundColor", event.target.value)
                    }
                    className="color-picker rounded-md px-1 py-0.5"
                  />
                </div>
                <div className="flex items-center justify-center gap-4">
                  <Label htmlFor="key-text-color">폰트 색상</Label>
                  <input
                    id="key-text-color"
                    type="color"
                    value={settings.keyDisplayTextColor}
                    onChange={(event) =>
                      set("keyDisplayTextColor", event.target.value)
                    }
                    className="color-picker rounded-md px-1 py-0.5"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <SettingSlider
                  label="지속 시간"
                  value={settings.keyDisplayDuration}
                  min={500}
                  max={5000}
                  step={100}
                  text={`${(settings.keyDisplayDuration / 1000).toFixed(1)}초`}
                  onChange={(value) => set("keyDisplayDuration", value)}
                />
                <SettingSlider
                  label="폰트 크기"
                  value={settings.keyDisplayFontSize}
                  min={10}
                  max={60}
                  step={1}
                  text={`${settings.keyDisplayFontSize}px`}
                  onChange={(value) => set("keyDisplayFontSize", value)}
                />
                <SettingSlider
                  label="배경 투명"
                  value={settings.keyDisplayBackgroundOpacity}
                  min={0}
                  max={1}
                  step={0.01}
                  text={settings.keyDisplayBackgroundOpacity.toFixed(2)}
                  onChange={(value) =>
                    set("keyDisplayBackgroundOpacity", value)
                  }
                />
              </div>
            </div>
            <div className="flex justify-around space-x-4">
              <div className="flex flex-col space-y-2">
                <Label htmlFor="key-display-monitor" className="text-center">
                  활성 모니터
                </Label>
                <Select
                  value={String(settings.keyDisplayId)}
                  onValueChange={(value) => set("keyDisplayId", Number(value))}
                >
                  <SelectTrigger id="key-display-monitor">
                    <SelectValue placeholder="모니터 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {displays.length ? (
                      displays.map((display) => (
                        <SelectItem key={display.id} value={String(display.id)}>
                          {display.name}
                        </SelectItem>
                      ))
                    ) : (
                      <SelectItem value="-1">모니터 없음</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col space-y-2">
                <Label htmlFor="key-display-position" className="text-center">
                  표시 위치
                </Label>
                <Select
                  value={settings.keyDisplayPosition}
                  onValueChange={(value) =>
                    set("keyDisplayPosition", value as KeyDisplayPosition)
                  }
                >
                  <SelectTrigger id="key-display-position">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="top-left">좌측 상단</SelectItem>
                    <SelectItem value="top-right">우측 상단</SelectItem>
                    <SelectItem value="bottom-left">좌측 하단</SelectItem>
                    <SelectItem value="bottom-right">우측 하단</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="annotation">
            <AnnotationControls
              tool={annotationState.tool}
              settings={{
                annotationPenColor: settings.annotationPenColor,
                annotationHighlighterColor: settings.annotationHighlighterColor,
                annotationPenWidth: settings.annotationPenWidth,
                annotationHighlighterWidth: settings.annotationHighlighterWidth,
                annotationEraserWidth: settings.annotationEraserWidth,
              }}
              onToolChange={chooseAnnotationTool}
              onCommand={sendAnnotationCommand}
              onSettingChange={setAnnotationPreference}
              unavailableShortcuts={annotationState.unavailableShortcuts}
              canUndo={annotationState.canUndo}
              canRedo={annotationState.canRedo}
            />
          </TabsContent>
        </Tabs>
      </div>
      <button
        type="button"
        onClick={reset}
        className="bg-destructive mb-2 ml-2 h-6 rounded-md px-3 text-xs text-white hover:opacity-90"
      >
        리셋
      </button>
    </>
  );
}

interface SettingSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  text: string;
  onChange(value: number): void;
}

function SettingSlider({
  label,
  value,
  min,
  max,
  step,
  text,
  onChange,
}: SettingSliderProps) {
  return (
    <div className="flex items-center space-x-2 pb-2">
      <Label className="whitespace-nowrap">{label}</Label>
      <Slider
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={(next) => onChange(next[0])}
      />
      <span className="whitespace-nowrap">{text}</span>
    </div>
  );
}
