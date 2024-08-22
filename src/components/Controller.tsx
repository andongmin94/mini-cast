import { useEffect, useState } from "react";

import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";

export default function Controller() {
  const [cursorColor, setCursorColor] = useState("#000000");
  const [cursorSize, setCursorSize] = useState(24);
  const [showCursorHighlight, setShowCursorHighlight] = useState(true);
  const [showClickHighlight, setShowClickHighlight] = useState(true);
  const [clickColor, setClickColor] = useState("#000000");
  const [clickSize, setClickSize] = useState(20);
  const [clickDuration, setClickDuration] = useState(1000);

  useEffect(() => {
    electron.send("update-settings", {
      cursorColor,
      cursorSize,
      showCursorHighlight,
      showClickHighlight,
      clickColor,
      clickSize,
      clickDuration,
    });
  }, [
    cursorColor,
    cursorSize,
    showCursorHighlight,
    showClickHighlight,
    clickColor,
    clickSize,
    clickDuration,
  ]);

  return (
    <div className="pointer-events-auto max-w-sm rounded-lg p-4 pt-8">
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
          <div className="flex items-center space-x-2">
            <Label htmlFor="click-highlight">클릭 활성화</Label>
            <Switch
              id="click-highlight"
              checked={showClickHighlight}
              onCheckedChange={setShowClickHighlight}
            />
          </div>
        </div>
        <hr />
        <div className="flex items-center justify-center space-x-2">
          <Label htmlFor="cursor-color">커서 색상 </Label>
          <input
            type="color"
            id="cursor-color"
            value={cursorColor}
            onChange={(e) => setCursorColor(e.target.value)}
            className="block"
          />
        </div>
        <hr />
        <div>
          <Label htmlFor="cursor-size">커서 크기 {cursorSize}px</Label>
          <br />
          <br />
          <Slider
            id="cursor-size"
            min={12}
            max={48}
            step={2}
            value={[cursorSize]}
            onValueChange={(value) => setCursorSize(value[0])}
          />
        </div>
        <hr />
        <div className="flex items-center justify-center space-x-2">
          <Label htmlFor="click-color">클릭 색상 </Label>
          <input
            type="color"
            id="click-color"
            value={clickColor}
            onChange={(e) => setClickColor(e.target.value)}
            className="block"
          />
        </div>
        <hr />
        <div>
          <Label htmlFor="click-size">클릭 크기 {clickSize}px</Label>
          <br />
          <br />
          <Slider
            id="click-size"
            min={10}
            max={60}
            step={2}
            value={[clickSize]}
            onValueChange={(value) => setClickSize(value[0])}
          />
        </div>
        <hr />
        <div>
          <Label htmlFor="click-duration">
            클릭 지속시간 {(clickDuration / 1000).toFixed(1)}초
          </Label>
          <br />
          <br />
          <Slider
            id="click-duration"
            min={200}
            max={2000}
            step={100}
            value={[clickDuration]}
            onValueChange={(value) => setClickDuration(value[0])}
          />
        </div>
      </div>
    </div>
  );
}