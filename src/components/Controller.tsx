import { useEffect, useState } from "react";

import { Keyboard, MousePointer2, PenLine } from "lucide-react";

import AnnotationControls from "@/components/AnnotationControls";
import TitleBar from "@/components/TitleBar";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  AnnotationCommand,
  AnnotationPreferences,
  AnnotationState,
  AnnotationTool,
  DisplayInfo,
  KeyDisplayPosition,
  OverlaySettings,
} from "@/electron/contract";

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

const DEFAULT_SETTINGS: Settings = {
  cursorFillColor: "#0064FF",
  cursorFillOpacity: 0.5,
  cursorStrokeColor: "#202632",
  cursorStrokeOpacity: 0.5,
  cursorSize: 30,
  cursorStrokeSize: 3,
  showCursorHighlight: true,
  keyDisplayId: 0,
  keyDisplayDuration: 2000,
  keyDisplayFontSize: 16,
  keyDisplayBackgroundColor: "#000000",
  keyDisplayBackgroundOpacity: 0.5,
  keyDisplayTextColor: "#FFFFFF",
  keyDisplayPosition: "bottom-right",
  showKeyDisplay: true,
  annotationPenColor: "#FF3B30",
  annotationHighlighterColor: "#FFD60A",
  annotationPenWidth: 4,
  annotationHighlighterWidth: 18,
  annotationEraserWidth: 28,
};

function hexToRgba(hex: string, opacity: number) {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgba(${value >> 16}, ${(value >> 8) & 255}, ${value & 255}, ${1 - opacity})`;
}

function rgbaToColor(value: string) {
  const match = value.match(
    /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/,
  );
  if (!match) return { color: "#000000", opacity: 0 };

  const color = `#${[match[1], match[2], match[3]]
    .map((part) => Number(part).toString(16).padStart(2, "0"))
    .join("")}`;
  return { color, opacity: 1 - Number(match[4] ?? 1) };
}

function fromOverlaySettings(settings: OverlaySettings): Settings {
  const fill = rgbaToColor(settings.cursorFillColor);
  const stroke = rgbaToColor(settings.cursorStrokeColor);
  const background = rgbaToColor(settings.keyDisplayBackgroundColor);

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
    cursorFillColor: hexToRgba(
      settings.cursorFillColor,
      settings.cursorFillOpacity,
    ),
    cursorStrokeColor: hexToRgba(
      settings.cursorStrokeColor,
      settings.cursorStrokeOpacity,
    ),
    cursorSize: settings.cursorSize,
    cursorStrokeSize: settings.cursorStrokeSize,
    showCursorHighlight: settings.showCursorHighlight,
    keyDisplayId: settings.keyDisplayId,
    keyDisplayDuration: settings.keyDisplayDuration,
    keyDisplayFontSize: settings.keyDisplayFontSize,
    keyDisplayBackgroundColor: hexToRgba(
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

export default function Controller() {
  const hasBridge = typeof miniCast !== "undefined";
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [annotationState, setAnnotationState] = useState<AnnotationState>({
    tool: "pass-through",
    unavailableShortcuts: [],
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

    const stopAnnotation = miniCast.onAnnotationStateUpdated(setAnnotationState);
    return () => {
      active = false;
      stopAnnotation();
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
      <div className="pointer-events-auto z-[999] h-[336px] overflow-hidden p-4">
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
            <TabsTrigger value="annotation">
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
                  onValueChange={(value) =>
                    set("keyDisplayId", Number(value))
                  }
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
                annotationHighlighterColor:
                  settings.annotationHighlighterColor,
                annotationPenWidth: settings.annotationPenWidth,
                annotationHighlighterWidth:
                  settings.annotationHighlighterWidth,
                annotationEraserWidth: settings.annotationEraserWidth,
              }}
              onToolChange={chooseAnnotationTool}
              onCommand={sendAnnotationCommand}
              onSettingChange={setAnnotationPreference}
              unavailableShortcuts={annotationState.unavailableShortcuts}
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
