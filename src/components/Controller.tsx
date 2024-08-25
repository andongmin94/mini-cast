import React, { useCallback, useEffect, useRef, useState } from "react";

import "@/globals.css";

import { Keyboard, MousePointer2 } from "lucide-react";

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
import TitleBar from "@/components/TitleBar";

function hexToRgba(hex: string, alpha: number = 1) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${1 - alpha})`;
}

interface Display {
  id: number;
  name: string;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export default function Controller() {
  const [cursorFillColor, setCursorFillColor] = useState("#FFFF00");
  const [cursorFillOpacity, setCursorFillOpacity] = useState(0.5);
  const [cursorStrokeColor, setCursorStrokeColor] = useState("#FF0000");
  const [cursorStrokeOpacity, setCursorStrokeOpacity] = useState(0.5);
  const [cursorSize, setCursorSize] = useState(30);
  const [showCursorHighlight, setShowCursorHighlight] = useState(true);
  const [keyDisplayMonitor, setKeyDisplayMonitor] = useState(0);
  const [keyDisplayDuration, setKeyDisplayDuration] = useState(2000);
  const [keyDisplayFontSize, setKeyDisplayFontSize] = useState(16);
  const [keyDisplayBackgroundColor, setKeyDisplayBackgroundColor] =
    useState("#000000");
  const [keyDisplayBackgroundOpacity, setKeyDisplayBackgroundOpacity] =
    useState(0.2);
  const [keyDisplayTextColor, setKeyDisplayTextColor] = useState("#FFFFFF");
  const [keyDisplayPosition, setKeyDisplayPosition] = useState("bottom-right");
  const [displays, setDisplays] = useState<Display[]>([]);
  const [cursorSettingsWidth, setCursorSettingsWidth] = useState(50);
  const [showKeyDisplay, setShowKeyDisplay] = useState(true);

  const dividerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (dividerRef.current && containerRef.current) {
      const containerRect = containerRef.current.getBoundingClientRect();
      const newX = e.clientX - containerRect.left;
      const newWidth = (newX / containerRect.width) * 100;
      setCursorSettingsWidth(Math.max(20, Math.min(80, newWidth)));
    }
  }, []);

  const handleMouseUp = useCallback(() => {
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);
  }, [handleMouseMove]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [handleMouseMove, handleMouseUp],
  );

  useEffect(() => {
    const handleDisplaysUpdated = (updatedDisplays: Display[]) => {
      setDisplays(updatedDisplays);
    };

    electron.on("displays-updated", handleDisplaysUpdated);
    electron.send("request-displays");

    return () => {
      electron.removeListener("displays-updated", handleDisplaysUpdated);
    };
  }, []);

  useEffect(() => {
    electron.send("update-settings", {
      cursorFillColor: hexToRgba(cursorFillColor, cursorFillOpacity),
      cursorStrokeColor: hexToRgba(cursorStrokeColor, cursorStrokeOpacity),
      cursorSize,
      showCursorHighlight,
      keyDisplayMonitor,
      keyDisplayDuration,
      keyDisplayFontSize,
      keyDisplayBackgroundColor: hexToRgba(
        keyDisplayBackgroundColor,
        keyDisplayBackgroundOpacity,
      ),
      keyDisplayTextColor,
      keyDisplayPosition,
      showKeyDisplay,
    });
  }, [
    cursorFillColor,
    cursorFillOpacity,
    cursorStrokeColor,
    cursorStrokeOpacity,
    cursorSize,
    showCursorHighlight,
    keyDisplayMonitor,
    keyDisplayDuration,
    keyDisplayFontSize,
    keyDisplayBackgroundColor,
    keyDisplayBackgroundOpacity,
    keyDisplayTextColor,
    keyDisplayPosition,
    showKeyDisplay,
  ]);

  return (
    <>
      <TitleBar />
      <div className="pointer-events-auto overflow-hidden p-4 pb-0">
        <div className="mb-2 flex items-center justify-center">
          <h2 className="text-xl font-bold">커서 Kersor</h2>
        </div>
        <hr className="mb-2" />
        <div ref={containerRef} className="relative flex flex-row">
          {/* 커서 설정 */}
          <div
            className="space-y-4 pr-4"
            style={{ width: `${cursorSettingsWidth}%` }}
          >
            <h3 className="flex items-center justify-center space-x-2 text-center text-lg font-semibold">
              <MousePointer2 className="h-4 w-4" />
              <span>커서 설정</span>
            </h3>
            <div className="flex items-center justify-center space-x-2">
              <Label htmlFor="cursor-highlight" className="whitespace-nowrap">
                커서 활성화
              </Label>
              <Switch
                id="cursor-highlight"
                checked={showCursorHighlight}
                onCheckedChange={setShowCursorHighlight}
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-center space-x-2">
                <Label
                  htmlFor="cursor-fill-color"
                  className="whitespace-nowrap"
                >
                  커서 칠 색상
                </Label>
                <input
                  type="color"
                  id="cursor-fill-color"
                  value={cursorFillColor}
                  onChange={(e) => setCursorFillColor(e.target.value)}
                  className="h-8 w-8"
                />
              </div>
              <div className="flex items-center justify-center space-x-2">
                <Label
                  htmlFor="cursor-fill-opacity"
                  className="whitespace-nowrap"
                >
                  칠 투명도
                </Label>
                <Slider
                  id="cursor-fill-opacity"
                  min={0}
                  max={1}
                  step={0.01}
                  value={[cursorFillOpacity]}
                  onValueChange={(value) => setCursorFillOpacity(value[0])}
                />
                <span>{cursorFillOpacity.toFixed(2)}</span>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-center space-x-2">
                <Label
                  htmlFor="cursor-stroke-color"
                  className="whitespace-nowrap"
                >
                  커서 획 색상
                </Label>
                <input
                  type="color"
                  id="cursor-stroke-color"
                  value={cursorStrokeColor}
                  onChange={(e) => setCursorStrokeColor(e.target.value)}
                  className="h-8 w-8"
                />
              </div>
              <div className="flex items-center justify-center space-x-2">
                <Label
                  htmlFor="cursor-stroke-opacity"
                  className="whitespace-nowrap"
                >
                  획 투명도
                </Label>
                <Slider
                  id="cursor-stroke-opacity"
                  min={0}
                  max={1}
                  step={0.01}
                  value={[cursorStrokeOpacity]}
                  onValueChange={(value) => setCursorStrokeOpacity(value[0])}
                />
                <span>{cursorStrokeOpacity.toFixed(2)}</span>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <Label htmlFor="cursor-size" className="whitespace-nowrap">
                커서 크기
              </Label>
              <Slider
                id="cursor-size"
                min={10}
                max={60}
                step={1}
                value={[cursorSize]}
                onValueChange={(value) => setCursorSize(value[0])}
              />
              <span>{cursorSize}px</span>
            </div>
          </div>

          {/* 분할선 */}
          <div
            ref={dividerRef}
            className="w-1 cursor-col-resize bg-gray-200 transition-all duration-200 ease-in-out hover:bg-gray-300"
            onMouseDown={handleMouseDown}
          />

          {/* 키 설정 */}
          <div
            className="space-y-4 pl-4"
            style={{ width: `${100 - cursorSettingsWidth}%` }}
          >
            <h3 className="flex items-center justify-center space-x-2 text-center text-lg font-semibold">
              <Keyboard className="h-4 w-4" />
              <span>키 설정</span>
            </h3>
            <div className="flex items-center justify-center space-x-2">
              <Label htmlFor="key-display-active" className="whitespace-nowrap">
                키 표시 활성화
              </Label>
              <Switch
                id="key-display-active"
                checked={showKeyDisplay}
                onCheckedChange={setShowKeyDisplay}
              />
            </div>
            <div className="flex justify-around space-x-4">
              <div className="flex flex-col space-y-2">
                <Label
                  htmlFor="key-display-monitor"
                  className="whitespace-nowrap"
                >
                  키 표시 모니터
                </Label>
                <Select
                  value={keyDisplayMonitor.toString()}
                  onValueChange={(value) =>
                    setKeyDisplayMonitor(parseInt(value))
                  }
                >
                  <SelectTrigger>
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
                  className="whitespace-nowrap"
                >
                  키 표시 위치
                </Label>
                <Select
                  value={keyDisplayPosition}
                  onValueChange={setKeyDisplayPosition}
                >
                  <SelectTrigger>
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
            <div className="flex items-center space-x-2">
              <Label
                htmlFor="key-display-duration"
                className="whitespace-nowrap"
              >
                지속시간
              </Label>
              <Slider
                id="key-display-duration"
                min={500}
                max={5000}
                step={100}
                value={[keyDisplayDuration]}
                onValueChange={(value) => setKeyDisplayDuration(value[0])}
              />
              <span className="whitespace-nowrap">
                {(keyDisplayDuration / 1000).toFixed(1)}초
              </span>
            </div>
            <div className="flex items-center space-x-2">
              <Label
                htmlFor="key-display-font-size"
                className="whitespace-nowrap"
              >
                폰트 크기
              </Label>
              <Slider
                id="key-display-font-size"
                min={10}
                max={60}
                step={1}
                value={[keyDisplayFontSize]}
                onValueChange={(value) => setKeyDisplayFontSize(value[0])}
              />
              <span>{keyDisplayFontSize}px</span>
            </div>
            <div className="space-y-2">
              <div className="flex justify-evenly space-x-2">
                <div className="flex items-center">
                  <Label
                    htmlFor="key-display-background-color"
                    className="whitespace-nowrap"
                  >
                    키 표시 배경색&nbsp;&nbsp;
                  </Label>
                  <input
                    type="color"
                    id="key-display-background-color"
                    value={keyDisplayBackgroundColor}
                    onChange={(e) =>
                      setKeyDisplayBackgroundColor(e.target.value)
                    }
                    className="h-8 w-8"
                  />
                </div>
                <div className="flex items-center">
                  <Label
                    htmlFor="key-display-text-color"
                    className="whitespace-nowrap"
                  >
                    키 표시 텍스트 색상&nbsp;&nbsp;
                  </Label>
                  <input
                    type="color"
                    id="key-display-text-color"
                    value={keyDisplayTextColor}
                    onChange={(e) => setKeyDisplayTextColor(e.target.value)}
                    className="h-8 w-8"
                  />
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <Label
                  htmlFor="key-display-background-opacity"
                  className="whitespace-nowrap"
                >
                  배경 투명도
                </Label>
                <Slider
                  id="key-display-background-opacity"
                  min={0}
                  max={1}
                  step={0.01}
                  value={[keyDisplayBackgroundOpacity]}
                  onValueChange={(value) =>
                    setKeyDisplayBackgroundOpacity(value[0])
                  }
                />
                <span>{keyDisplayBackgroundOpacity.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
