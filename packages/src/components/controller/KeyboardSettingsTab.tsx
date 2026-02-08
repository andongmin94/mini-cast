import {
  type ControllerSettings,
  type Display,
} from "@/components/settings/types";
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

interface KeyboardSettingsTabProps {
  settings: ControllerSettings;
  displays: Display[];
  onSettingChange: <K extends keyof ControllerSettings>(
    key: K,
    value: ControllerSettings[K],
  ) => void;
}

export default function KeyboardSettingsTab({
  settings,
  displays,
  onSettingChange,
}: KeyboardSettingsTabProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-center space-x-2">
        <Label htmlFor="key-display-active" className="whitespace-nowrap">
          키보드 활성화
        </Label>
        <Switch
          id="key-display-active"
          checked={settings.showKeyDisplay}
          onCheckedChange={(value) => onSettingChange("showKeyDisplay", value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <div className="flex items-center justify-center gap-4">
            <Label
              htmlFor="key-display-background-color"
              className="whitespace-nowrap"
            >
              배경 색상
            </Label>
            <input
              type="color"
              id="key-display-background-color"
              value={settings.keyDisplayBackgroundColor}
              onChange={(e) =>
                onSettingChange("keyDisplayBackgroundColor", e.target.value)
              }
              className="color-picker rounded-md px-1 py-0.5"
            />
          </div>
          <div className="flex items-center justify-center gap-4">
            <Label htmlFor="key-display-text-color" className="whitespace-nowrap">
              폰트 색상
            </Label>
            <input
              type="color"
              id="key-display-text-color"
              value={settings.keyDisplayTextColor}
              onChange={(e) =>
                onSettingChange("keyDisplayTextColor", e.target.value)
              }
              className="color-picker rounded-md px-1 py-0.5"
            />
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center space-x-2">
            <Label htmlFor="key-display-duration" className="whitespace-nowrap">
              지속 시간
            </Label>
            <Slider
              id="key-display-duration"
              min={500}
              max={5000}
              step={100}
              value={[settings.keyDisplayDuration]}
              onValueChange={(value) =>
                onSettingChange("keyDisplayDuration", value[0])
              }
            />
            <span className="whitespace-nowrap">
              {(settings.keyDisplayDuration / 1000).toFixed(1)}초
            </span>
          </div>
          <div className="flex items-center space-x-2">
            <Label htmlFor="key-display-font-size" className="whitespace-nowrap">
              폰트 크기
            </Label>
            <Slider
              id="key-display-font-size"
              min={10}
              max={60}
              step={1}
              value={[settings.keyDisplayFontSize]}
              onValueChange={(value) =>
                onSettingChange("keyDisplayFontSize", value[0])
              }
            />
            <span>{settings.keyDisplayFontSize}px</span>
          </div>
          <div className="flex items-center space-x-2">
            <Label
              htmlFor="key-display-background-opacity"
              className="whitespace-nowrap"
            >
              배경 투명
            </Label>
            <Slider
              id="key-display-background-opacity"
              min={0}
              max={1}
              step={0.01}
              value={[settings.keyDisplayBackgroundOpacity]}
              onValueChange={(value) =>
                onSettingChange("keyDisplayBackgroundOpacity", value[0])
              }
            />
            <span>{settings.keyDisplayBackgroundOpacity.toFixed(2)}</span>
          </div>
        </div>
      </div>
      <div className="flex justify-around space-x-4">
        <div className="flex flex-col space-y-2">
          <Label
            htmlFor="key-display-monitor"
            className="text-center whitespace-nowrap"
          >
            활성 모니터
          </Label>
          <Select
            value={settings.keyDisplayMonitor.toString()}
            onValueChange={(value) =>
              onSettingChange("keyDisplayMonitor", Number(value))
            }
          >
            <SelectTrigger className="hover:bg-accent">
              <SelectValue placeholder="모니터 선택" />
            </SelectTrigger>
            <SelectContent>
              {displays.length > 0 ? (
                displays.map((display, index) => (
                  <SelectItem key={display.id} value={index.toString()}>
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
          <Label
            htmlFor="key-display-position"
            className="text-center whitespace-nowrap"
          >
            표시 위치
          </Label>
          <Select
            value={settings.keyDisplayPosition}
            onValueChange={(value) =>
              onSettingChange(
                "keyDisplayPosition",
                value as ControllerSettings["keyDisplayPosition"],
              )
            }
          >
            <SelectTrigger className="hover:bg-accent">
              <SelectValue placeholder="위치 선택" />
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
    </div>
  );
}
