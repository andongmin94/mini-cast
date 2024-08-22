import { useEffect, useState } from "react";

import "@/globals.css";

//////////////// electron components ////////////////
import TitleBar from "@/components/TitleBar";
/////////////////////////////////////////////////////

import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";

function hexToRgba(hex: string, alpha: number = 1) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default function Controller() {
  const [cursorFillColor, setCursorFillColor] = useState("#FFFF00");
  const [cursorFillOpacity, setCursorFillOpacity] = useState(0.5);
  const [cursorStrokeColor, setCursorStrokeColor] = useState("#FF0000");
  const [cursorStrokeOpacity, setCursorStrokeOpacity] = useState(0.5);
  const [cursorSize, setCursorSize] = useState(30);
  const [showCursorHighlight, setShowCursorHighlight] = useState(true);

  useEffect(() => {
    electron.send("update-settings", {
      cursorFillColor: hexToRgba(cursorFillColor, cursorFillOpacity),
      cursorStrokeColor: hexToRgba(cursorStrokeColor, cursorStrokeOpacity),
      cursorSize,
      showCursorHighlight,
    });
  }, [
    cursorFillColor,
    cursorFillOpacity,
    cursorStrokeColor,
    cursorStrokeOpacity,
    cursorSize,
    showCursorHighlight,
  ]);

  return (
    <>
    <TitleBar />
    <div className="pointer-events-auto max-w-sm rounded-lg p-4 pt-12">
      <div className="mb-2 flex items-center justify-center">
        <h2 className="text-xl font-bold">커서 Kersor</h2>
      </div>
      <div className="space-y-4">
        <hr />
        <div className="flex items-center justify-center space-x-4">
          <div className="flex items-center space-x-2">
            <Label htmlFor="cursor-highlight">커서 활성화</Label>
            <Switch
              id="cursor-highlight"
              checked={showCursorHighlight}
              onCheckedChange={setShowCursorHighlight}
            />
          </div>
        </div>
        <hr />
        <div className="flex items-center justify-center space-x-2">
          <Label htmlFor="cursor-fill-color">커서 칠 색상</Label>
          <input
            type="color"
            id="cursor-fill-color"
            value={cursorFillColor}
            onChange={(e) => setCursorFillColor(e.target.value)}
            className="block"
          />
        </div>
        <div>
          <Label htmlFor="cursor-fill-opacity">커서 칠 불투명도 {cursorFillOpacity.toFixed(2)}</Label>
          <Slider
            id="cursor-fill-opacity"
            min={0}
            max={1}
            step={0.01}
            value={[cursorFillOpacity]}
            onValueChange={(value) => setCursorFillOpacity(value[0])}
          />
        </div>
        <hr />
        <div className="flex items-center justify-center space-x-2">
          <Label htmlFor="cursor-stroke-color">커서 획 색상</Label>
          <input
            type="color"
            id="cursor-stroke-color"
            value={cursorStrokeColor}
            onChange={(e) => setCursorStrokeColor(e.target.value)}
            className="block"
          />
        </div>
        <div>
          <Label htmlFor="cursor-stroke-opacity">커서 획 불투명도 {cursorStrokeOpacity.toFixed(2)}</Label>
          <Slider
            id="cursor-stroke-opacity"
            min={0}
            max={1}
            step={0.01}
            value={[cursorStrokeOpacity]}
            onValueChange={(value) => setCursorStrokeOpacity(value[0])}
          />
        </div>
        <hr />
        <div>
          <Label htmlFor="cursor-size">커서 크기 {cursorSize}px</Label>
          <Slider
            id="cursor-size"
            min={12}
            max={48}
            step={2}
            value={[cursorSize]}
            onValueChange={(value) => setCursorSize(value[0])}
          />
        </div>
      </div>
    </div>
    </>
  );
}