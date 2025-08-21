import { useEffect, useState } from "react";

import "@/globals.css";

import { Keyboard, MousePointer2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
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
import TitleBar from "@/components/TitleBar";

import packageJson from "../../package.json";

function hexToRgba(hex: string, alpha: number = 1) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function rgbaToHex(rgba: string): { hex: string; opacity: number } {
  const match = rgba.match(
    /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*(\d+(?:\.\d+)?))?\)/,
  );
  if (match) {
    const r = parseInt(match[1]);
    const g = parseInt(match[2]);
    const b = parseInt(match[3]);
    const a = match[4] ? parseFloat(match[4]) : 1;
    const hex =
      "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    return { hex, opacity: 1 - a };
  }
  return { hex: "#000000", opacity: 0 };
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
  const [cursorFillColor, setCursorFillColor] = useState("#0064FF");
  const [cursorFillOpacity, setCursorFillOpacity] = useState(0.5);
  const [cursorStrokeColor, setCursorStrokeColor] = useState("#202632");
  const [cursorStrokeOpacity, setCursorStrokeOpacity] = useState(0.5);
  const [cursorSize, setCursorSize] = useState(30);
  const [cursorStrokeSize, setCursorStrokeSize] = useState(3);
  const [showCursorHighlight, setShowCursorHighlight] = useState(true);
  const [keyDisplayMonitor, setKeyDisplayMonitor] = useState(0);
  const [keyDisplayDuration, setKeyDisplayDuration] = useState(2000);
  const [keyDisplayFontSize, setKeyDisplayFontSize] = useState(16);
  const [keyDisplayBackgroundColor, setKeyDisplayBackgroundColor] =
    useState("#000000");
  const [keyDisplayBackgroundOpacity, setKeyDisplayBackgroundOpacity] =
    useState(0.5);
  const [keyDisplayTextColor, setKeyDisplayTextColor] = useState("#FFFFFF");
  const [keyDisplayPosition, setKeyDisplayPosition] = useState("bottom-right");
  const [displays, setDisplays] = useState<Display[]>([]);
  const [showKeyDisplay, setShowKeyDisplay] = useState(true);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const savedSettings = await electron.get("settings");
        if (savedSettings) {
          const { hex: fillHex, opacity: fillOpacity } = rgbaToHex(
            savedSettings.cursorFillColor,
          );
          const { hex: strokeHex, opacity: strokeOpacity } = rgbaToHex(
            savedSettings.cursorStrokeColor,
          );
          const { hex: bgHex, opacity: bgOpacity } = rgbaToHex(
            savedSettings.keyDisplayBackgroundColor,
          );

          setCursorFillColor(fillHex);
          setCursorFillOpacity(fillOpacity);
          setCursorStrokeColor(strokeHex);
          setCursorStrokeOpacity(strokeOpacity);
          setCursorSize(savedSettings.cursorSize);
          setCursorStrokeSize(savedSettings.cursorStrokeSize);
          setShowCursorHighlight(savedSettings.showCursorHighlight);
          setKeyDisplayMonitor(savedSettings.keyDisplayMonitor);
          setKeyDisplayDuration(savedSettings.keyDisplayDuration);
          setKeyDisplayFontSize(savedSettings.keyDisplayFontSize);
          setKeyDisplayBackgroundColor(bgHex);
          setKeyDisplayBackgroundOpacity(bgOpacity);
          setKeyDisplayTextColor(savedSettings.keyDisplayTextColor);
          setKeyDisplayPosition(savedSettings.keyDisplayPosition);
          setShowKeyDisplay(savedSettings.showKeyDisplay);
        }
      } catch (error) {
        console.error("Failed to load settings:", error);
      }
    };

    loadSettings();
  }, []);

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
    const settings = {
      cursorFillColor: hexToRgba(cursorFillColor, 1 - cursorFillOpacity),
      cursorStrokeColor: hexToRgba(cursorStrokeColor, 1 - cursorStrokeOpacity),
      cursorSize,
      cursorStrokeSize,
      showCursorHighlight,
      keyDisplayMonitor,
      keyDisplayDuration,
      keyDisplayFontSize,
      keyDisplayBackgroundColor: hexToRgba(
        keyDisplayBackgroundColor,
        1 - keyDisplayBackgroundOpacity,
      ),
      keyDisplayTextColor,
      keyDisplayPosition,
      showKeyDisplay,
    };

    electron.send("update-settings", settings);
  }, [
    cursorFillColor,
    cursorFillOpacity,
    cursorStrokeColor,
    cursorStrokeOpacity,
    cursorSize,
    cursorStrokeSize,
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

  const resetConfig = () => {
    setCursorFillColor("#0064FF");
    setCursorFillOpacity(0.5);
    setCursorStrokeColor("#202632");
    setCursorStrokeOpacity(0.5);
    setCursorSize(30);
    setCursorStrokeSize(3);
    setShowCursorHighlight(true);
    setKeyDisplayMonitor(0);
    setKeyDisplayDuration(2000);
    setKeyDisplayFontSize(16);
    setKeyDisplayBackgroundColor("#000000");
    setKeyDisplayBackgroundOpacity(0.5);
    setKeyDisplayTextColor("#FFFFFF");
    setKeyDisplayPosition("bottom-right");
    setShowKeyDisplay(true);
  };

  return (
    <>
      <TitleBar />

      <div className="pointer-events-auto z-999 h-[280px] overflow-hidden p-4">
        <Tabs defaultValue="cursor" className="w-full">
          <TabsList className="z-999 grid w-full grid-cols-2">
            <TabsTrigger value="cursor">
              <MousePointer2 className="mr-2 h-4 w-4" />
              커서 설정
            </TabsTrigger>
            <TabsTrigger value="keyboard">
              <Keyboard className="mr-2 h-4 w-4" />
              키보드 설정
            </TabsTrigger>
            {/* <TabsTrigger value="canvas">
              <PenTool className="mr-2 h-4 w-4" />
              캔버스 설정
            </TabsTrigger> */}
          </TabsList>
          <TabsContent value="cursor" className="space-y-4">
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
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center justify-center gap-4">
                  <Label
                    htmlFor="cursor-fill-color"
                    className="whitespace-nowrap"
                  >
                    칠 색상
                  </Label>
                  <input
                    type="color"
                    id="cursor-fill-color"
                    value={cursorFillColor}
                    onChange={(e) => setCursorFillColor(e.target.value)}
                    className="color-picker rounded-md px-1 py-0.5"
                  />
                </div>
                <div className="flex items-center justify-center gap-4">
                  <Label
                    htmlFor="cursor-stroke-color"
                    className="whitespace-nowrap"
                  >
                    획 색상
                  </Label>
                  <input
                    type="color"
                    id="cursor-stroke-color"
                    value={cursorStrokeColor}
                    onChange={(e) => setCursorStrokeColor(e.target.value)}
                    className="color-picker rounded-md px-1 py-0.5"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center space-x-2 pb-3">
                  <Label
                    htmlFor="cursor-fill-opacity"
                    className="whitespace-nowrap"
                  >
                    칠 투명
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
                <div className="flex items-center space-x-2 pb-3">
                  <Label
                    htmlFor="cursor-stroke-opacity"
                    className="whitespace-nowrap"
                  >
                    획 투명
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
                <div className="flex items-center space-x-2 pb-3">
                  <Label htmlFor="cursor-size" className="whitespace-nowrap">
                    칠 크기
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
                <div className="flex items-center space-x-2 pb-3">
                  <Label
                    htmlFor="cursor-stroke-size"
                    className="whitespace-nowrap"
                  >
                    획 크기
                  </Label>
                  <Slider
                    id="cursor-stroke-size"
                    min={0}
                    max={30}
                    step={1}
                    value={[cursorStrokeSize]}
                    onValueChange={(value) => setCursorStrokeSize(value[0])}
                  />
                  <span>{cursorStrokeSize}px</span>
                </div>
              </div>
            </div>
          </TabsContent>
          <TabsContent value="keyboard" className="space-y-4">
            <div className="flex items-center justify-center space-x-2">
              <Label htmlFor="key-display-active" className="whitespace-nowrap">
                키보드 활성화
              </Label>
              <Switch
                id="key-display-active"
                checked={showKeyDisplay}
                onCheckedChange={setShowKeyDisplay}
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
                    value={keyDisplayBackgroundColor}
                    onChange={(e) =>
                      setKeyDisplayBackgroundColor(e.target.value)
                    }
                    className="color-picker rounded-md px-1 py-0.5"
                  />
                </div>
                <div className="flex items-center justify-center gap-4">
                  <Label
                    htmlFor="key-display-text-color"
                    className="whitespace-nowrap"
                  >
                    폰트 색상
                  </Label>
                  <input
                    type="color"
                    id="key-display-text-color"
                    value={keyDisplayTextColor}
                    onChange={(e) => setKeyDisplayTextColor(e.target.value)}
                    className="color-picker rounded-md px-1 py-0.5"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <Label
                    htmlFor="key-display-duration"
                    className="whitespace-nowrap"
                  >
                    지속 시간
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
                    value={[keyDisplayBackgroundOpacity]}
                    onValueChange={(value) =>
                      setKeyDisplayBackgroundOpacity(value[0])
                    }
                  />
                  <span>{keyDisplayBackgroundOpacity.toFixed(2)}</span>
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
                  value={keyDisplayMonitor.toString()}
                  onValueChange={(value) =>
                    setKeyDisplayMonitor(parseInt(value))
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
                  value={keyDisplayPosition}
                  onValueChange={setKeyDisplayPosition}
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
          </TabsContent>
        </Tabs>
      </div>

      <div className="pointer-events-auto mr-1 flex items-end justify-between text-xs">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" className="mb-2 ml-2 h-6 w-10">
              리셋
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent className="mt-5 max-w-[355px] rounded-md p-4">
            <AlertDialogHeader>
              <AlertDialogTitle>정말로 리셋하시겠습니까?</AlertDialogTitle>
              <AlertDialogDescription>
                모든 설정이 초기화됩니다.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>취소</AlertDialogCancel>
              <AlertDialogAction onClick={resetConfig}>리셋</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        v{packageJson.version}
      </div>
      <div className="fixed bottom-0 left-0 h-[121px] w-full">
        <iframe
          src="https://andongmin.com/ad/mini-cast"
          className="h-full w-full border-0"
          sandbox="allow-scripts allow-same-origin"
        />
      </div>
      <div className="pb-[121px]"> {/* 기존 컨텐츠 래퍼 */}</div>
    </>
  );
}
