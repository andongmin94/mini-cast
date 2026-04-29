import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { type ControllerSettings } from "@/components/settings/types";

interface CursorSettingsTabProps {
  settings: ControllerSettings;
  onSettingChange: <K extends keyof ControllerSettings>(
    key: K,
    value: ControllerSettings[K],
  ) => void;
}

export default function CursorSettingsTab({
  settings,
  onSettingChange,
}: CursorSettingsTabProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-center space-x-2">
        <Label htmlFor="cursor-highlight" className="whitespace-nowrap">
          커서 활성화
        </Label>
        <Switch
          id="cursor-highlight"
          checked={settings.showCursorHighlight}
          onCheckedChange={(value) =>
            onSettingChange("showCursorHighlight", value)
          }
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <div className="flex items-center justify-center gap-4">
            <Label htmlFor="cursor-fill-color" className="whitespace-nowrap">
              칠 색상
            </Label>
            <input
              type="color"
              id="cursor-fill-color"
              value={settings.cursorFillColor}
              onChange={(e) => onSettingChange("cursorFillColor", e.target.value)}
              className="color-picker rounded-md px-1 py-0.5"
            />
          </div>
          <div className="flex items-center justify-center gap-4">
            <Label htmlFor="cursor-stroke-color" className="whitespace-nowrap">
              획 색상
            </Label>
            <input
              type="color"
              id="cursor-stroke-color"
              value={settings.cursorStrokeColor}
              onChange={(e) =>
                onSettingChange("cursorStrokeColor", e.target.value)
              }
              className="color-picker rounded-md px-1 py-0.5"
            />
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center space-x-2 pb-3">
            <Label htmlFor="cursor-fill-opacity" className="whitespace-nowrap">
              칠 투명
            </Label>
            <Slider
              id="cursor-fill-opacity"
              min={0}
              max={1}
              step={0.01}
              value={[settings.cursorFillOpacity]}
              onValueChange={(value) =>
                onSettingChange("cursorFillOpacity", value[0])
              }
            />
            <span>{settings.cursorFillOpacity.toFixed(2)}</span>
          </div>
          <div className="flex items-center space-x-2 pb-3">
            <Label htmlFor="cursor-stroke-opacity" className="whitespace-nowrap">
              획 투명
            </Label>
            <Slider
              id="cursor-stroke-opacity"
              min={0}
              max={1}
              step={0.01}
              value={[settings.cursorStrokeOpacity]}
              onValueChange={(value) =>
                onSettingChange("cursorStrokeOpacity", value[0])
              }
            />
            <span>{settings.cursorStrokeOpacity.toFixed(2)}</span>
          </div>
          <div className="flex items-center space-x-2 pb-3">
            <Label htmlFor="cursor-size" className="whitespace-nowrap">
              칠 크기
            </Label>
            <Slider
              id="cursor-size"
              min={10}
              max={60}
              step={1}
              value={[settings.cursorSize]}
              onValueChange={(value) => onSettingChange("cursorSize", value[0])}
            />
            <span>{settings.cursorSize}px</span>
          </div>
          <div className="flex items-center space-x-2 pb-3">
            <Label htmlFor="cursor-stroke-size" className="whitespace-nowrap">
              획 크기
            </Label>
            <Slider
              id="cursor-stroke-size"
              min={0}
              max={30}
              step={1}
              value={[settings.cursorStrokeSize]}
              onValueChange={(value) =>
                onSettingChange("cursorStrokeSize", value[0])
              }
            />
            <span>{settings.cursorStrokeSize}px</span>
          </div>
        </div>
      </div>
    </div>
  );
}
