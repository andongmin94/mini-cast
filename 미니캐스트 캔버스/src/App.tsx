import React, { useRef, useEffect, useState, MouseEvent } from 'react';
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Pencil, Eraser } from 'lucide-react';

interface Point {
  x: number;
  y: number;
}

interface Stroke {
  points: Point[];
  color: string;
  width: number;
  tool: 'pen' | 'eraser';
  opacity: number;
}

export default function Canvas(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isDrawingMode, setIsDrawingMode] = useState(true);
  const [strokeColor, setStrokeColor] = useState('#000000');
  const [lineWidth, setLineWidth] = useState(5);
  const [opacity, setOpacity] = useState(1);
  const [cursorPosition, setCursorPosition] = useState<Point>({ x: 0, y: 0 });
  const currentStrokeRef = useRef<Stroke | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const isErasingRef = useRef(false);

  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === 'F3') {
        setIsDrawingMode(prev => !prev);
      } else if (e.key === 'F4') {
        clearCanvas();
      }
    };

    window.addEventListener('keydown', handleKeyPress);

    return () => {
      window.removeEventListener('keydown', handleKeyPress);
    };
  }, []);

  const getPointFromEvent = (canvas: HTMLCanvasElement, e: MouseEvent): Point => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  };

  const drawStrokes = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    context.clearRect(0, 0, canvas.width, canvas.height);

    [...strokesRef.current, currentStrokeRef.current].filter(Boolean).forEach(stroke => {
      if (!stroke || stroke.points.length < 2) return;

      context.beginPath();
      context.moveTo(stroke.points[0].x, stroke.points[0].y);

      for (let i = 1; i < stroke.points.length; i++) {
        context.lineTo(stroke.points[i].x, stroke.points[i].y);
      }

      context.strokeStyle = stroke.tool === 'eraser' ? '#FFFFFF' : stroke.color;
      context.lineWidth = stroke.width;
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.globalAlpha = stroke.opacity;
      
      if (stroke.tool === 'eraser') {
        context.globalCompositeOperation = 'destination-out';
      } else {
        context.globalCompositeOperation = 'source-over';
      }

      context.stroke();
    });

    context.globalAlpha = 1;  // Reset global alpha
  };

  const startDrawing = (e: MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawingMode || !canvasRef.current) return;
    const point = getPointFromEvent(canvasRef.current, e);
    const tool = e.button === 2 ? 'eraser' : 'pen';
    isErasingRef.current = tool === 'eraser';
    currentStrokeRef.current = {
      points: [point],
      color: strokeColor,
      width: tool === 'eraser' ? lineWidth + 10 : lineWidth,
      tool: tool,
      opacity: opacity
    };
    setIsDrawing(true);
  };

  const draw = (e: MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return;
    const point = getPointFromEvent(canvasRef.current, e);
    setCursorPosition({ x: e.clientX, y: e.clientY }); // 화면 좌표로 설정

    if (!isDrawing || !isDrawingMode || !currentStrokeRef.current) return;
    currentStrokeRef.current.points.push(point);
    drawStrokes();
  };

  const stopDrawing = () => {
    if (currentStrokeRef.current) {
      strokesRef.current.push(currentStrokeRef.current);
    }
    currentStrokeRef.current = null;
    setIsDrawing(false);
    isErasingRef.current = false;
    drawStrokes();
  };

  const clearCanvas = () => {
    strokesRef.current = [];
    drawStrokes();
  };

  const handleLineWidthChange = (value: number[]) => {
    setLineWidth(value[0]);
  };

  const handleOpacityChange = (value: number[]) => {
    setOpacity(value[0]);
  };

  const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setStrokeColor(e.target.value);
  };

  const CustomCursor: React.FC<{ position: Point }> = ({ position }) => {
    const cursorSize = 24;
    return (
      <div style={{
        position: 'fixed',
        pointerEvents: 'none',
        zIndex: 9999,
        left: `${position.x}px`,
        top: `${position.y}px`,
        transform: 'translate(-50%, -50%)', // 커서를 중앙으로 이동
      }}>
        {isErasingRef.current ? (
          <Eraser size={cursorSize} color="black"
          style={{ 
            transform: 'translate(20%, -30%)', // 펜의 촉 부분이 커서에 오도록 조정
            transformOrigin: 'center'
          }}
           />
        ) : (
          <Pencil 
            size={cursorSize} 
            color={strokeColor}
            style={{ 
              transform: 'translate(40%, 40%) rotate(90deg)', // 펜의 촉 부분이 커서에 오도록 조정
              transformOrigin: 'center'
            }} 
          />
        )}
      </div>
    );
  };

  return (
    <div className="p-4 relative">
      {isDrawingMode && <CustomCursor position={cursorPosition} />}
      <canvas
        ref={canvasRef}
        width={800}
        height={600}
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={stopDrawing}
        onMouseOut={stopDrawing}
        onContextMenu={(e) => e.preventDefault()}
        className="border border-gray-300"
      />
      <div className="mt-4 space-y-2">
        <Button onClick={clearCanvas}>Clear Canvas (F4)</Button>
        <div className="flex items-center space-x-2">
          <span>Line Width:</span>
          <Slider
            value={[lineWidth]}
            onValueChange={handleLineWidthChange}
            min={1}
            max={50}
            step={1}
            className="w-[200px]"
          />
          <span>{lineWidth}px</span>
        </div>
        <div className="flex items-center space-x-2">
          <span>Opacity:</span>
          <Slider
            value={[opacity]}
            onValueChange={handleOpacityChange}
            min={0}
            max={1}
            step={0.01}
            className="w-[200px]"
          />
          <span>{Math.round(opacity * 100)}%</span>
        </div>
        <div className="flex items-center space-x-2">
          <span>Color:</span>
          <input
            type="color"
            value={strokeColor}
            onChange={handleColorChange}
            className="w-10 h-10 border-none"
          />
        </div>
        <div>
          <span>Drawing Mode: {isDrawingMode ? 'On' : 'Off'} (F3)</span>
        </div>
        <div>
          <span>Left Click: Pen, Right Click: Eraser</span>
        </div>
      </div>
    </div>
  );
}