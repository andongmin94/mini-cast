import { useEffect, useRef, useState } from "react";

import type { AnnotationDocumentSnapshot } from "@/annotation/history";
import AnnotationSurface from "@/components/AnnotationSurface";
import type {
  AnnotationState,
  AnnotationTool,
  KeyDisplayPosition,
  KeyPress,
  MouseButtonEvent,
  MousePosition,
  OverlayInit,
  OverlaySettings,
} from "@/electron/contract";
import { DEFAULT_OVERLAY_SETTINGS } from "@/electron/contract";

interface MouseButtons {
  left: boolean;
  middle: boolean;
  right: boolean;
}

const POSITION_CLASSES: Record<KeyDisplayPosition, string> = {
  "top-left": "top-4 left-4 items-start",
  "top-right": "top-4 right-4 items-end",
  "bottom-left": "bottom-4 left-4 items-start",
  "bottom-right": "right-4 bottom-4 items-end",
};

function formatKeyPress(keyPress: KeyPress) {
  return [
    keyPress.ctrlKey && "Ctrl",
    keyPress.shiftKey && "Shift",
    keyPress.altKey && "Alt",
    keyPress.metaKey && "Meta",
    keyPress.key,
  ]
    .filter(Boolean)
    .join(" + ");
}

function colorWithAlpha(color: string, alpha: number) {
  const match = color.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
  if (!match) return color;

  const [red, green, blue] = match.slice(1).map((part) => {
    return Number.parseInt(part, 16);
  });
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function toolCursor(tool: AnnotationTool, settings: OverlaySettings) {
  if (tool === "pen") {
    return {
      size: Math.max(settings.annotationPenWidth, 6),
      border: `1px solid ${settings.annotationPenColor}`,
      background: "rgba(255, 255, 255, 0.2)",
    };
  }
  if (tool === "highlighter") {
    return {
      size: settings.annotationHighlighterWidth,
      border: `1px solid ${settings.annotationHighlighterColor}`,
      background: colorWithAlpha(settings.annotationHighlighterColor, 0.24),
    };
  }
  if (tool === "eraser") {
    return {
      size: settings.annotationEraserWidth,
      border: "1px dashed rgba(32, 38, 50, 0.9)",
      background: "rgba(255, 255, 255, 0.3)",
    };
  }
  return null;
}

export default function Overlay() {
  const [settings, setSettings] = useState<OverlaySettings>(
    DEFAULT_OVERLAY_SETTINGS,
  );
  const [annotationState, setAnnotationState] = useState<AnnotationState>({
    tool: "pass-through",
    unavailableShortcuts: [],
  });
  const [annotationDocument, setAnnotationDocument] =
    useState<AnnotationDocumentSnapshot | null>(null);
  const [mousePosition, setMousePosition] = useState<MousePosition | null>(null);
  const [mouseButtons, setMouseButtons] = useState<MouseButtons>({
    left: false,
    middle: false,
    right: false,
  });
  const [keyPresses, setKeyPresses] = useState<KeyPress[]>([]);
  const [displayId, setDisplayId] = useState<number | null>(null);

  const settingsRef = useRef(settings);
  const displayIdRef = useRef<number | null>(null);
  const documentRevisionRef = useRef(-1);
  const sourceSize = useRef({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    if (typeof miniCast === "undefined") return;

    const scalePosition = (position: MousePosition) => ({
      x: Math.round(
        position.x * (window.innerWidth / Math.max(sourceSize.current.width, 1)),
      ),
      y: Math.round(
        position.y *
          (window.innerHeight / Math.max(sourceSize.current.height, 1)),
      ),
    });

    const onKeyPress = (keyPress: KeyPress) => {
      const current = settingsRef.current;
      if (
        !current.showKeyDisplay ||
        keyPress.displayId !== current.keyDisplayId
      ) {
        return;
      }

      setKeyPresses((items) => [...items, keyPress]);
      window.setTimeout(() => {
        setKeyPresses((items) => items.filter((item) => item !== keyPress));
      }, current.keyDisplayDuration);
    };

    const onMouseButton = ({ button, pressed }: MouseButtonEvent) => {
      setMouseButtons((current) => ({ ...current, [button]: pressed }));
    };

    const onOverlayInit = ({ displayId: physicalId, width, height }: OverlayInit) => {
      displayIdRef.current = physicalId;
      documentRevisionRef.current = -1;
      setAnnotationDocument(null);
      setDisplayId(physicalId);
      sourceSize.current = { width, height };
    };

    const onDocumentUpdated = (document: AnnotationDocumentSnapshot) => {
      if (
        document.displayId === displayIdRef.current &&
        document.revision >= documentRevisionRef.current
      ) {
        documentRevisionRef.current = document.revision;
        setAnnotationDocument(document);
      }
    };

    const unsubscribe = [
      miniCast.onSettingsUpdated(setSettings),
      miniCast.onAnnotationStateUpdated(setAnnotationState),
      miniCast.onAnnotationDocumentUpdated(onDocumentUpdated),
      miniCast.onMouseMove((position) =>
        setMousePosition(position ? scalePosition(position) : null),
      ),
      miniCast.onMouseButton(onMouseButton),
      miniCast.onKeyPress(onKeyPress),
      miniCast.onOverlayInit(onOverlayInit),
    ];

    miniCast.notifyOverlayReady();
    return () => unsubscribe.forEach((stop) => stop());
  }, []);

  const passive = annotationState.tool === "pass-through";
  const cursorPressed =
    mouseButtons.left || mouseButtons.middle || mouseButtons.right;
  const cursorRadius = settings.cursorSize / 2;
  const activeToolCursor = toolCursor(annotationState.tool, settings);

  return (
    <div className="pointer-events-none fixed inset-0" style={{ zIndex: 9999 }}>
      <AnnotationSurface
        tool={annotationState.tool}
        settings={settings}
        displayId={displayId}
        document={annotationDocument}
      />

      {mousePosition && passive && settings.showCursorHighlight && (
        <div
          className="absolute rounded-full"
          style={{
            zIndex: 3,
            width: settings.cursorSize,
            height: settings.cursorSize,
            backgroundColor: settings.cursorFillColor,
            border: cursorPressed
              ? `${Math.min(settings.cursorStrokeSize, cursorRadius)}px solid ${settings.cursorStrokeColor}`
              : "none",
            transform: `translate3d(${mousePosition.x - cursorRadius}px, ${mousePosition.y - cursorRadius}px, 0)`,
            willChange: "transform",
          }}
        />
      )}

      {mousePosition && activeToolCursor && (
        <div
          className="absolute rounded-full"
          style={{
            zIndex: 3,
            width: activeToolCursor.size,
            height: activeToolCursor.size,
            border: activeToolCursor.border,
            backgroundColor: activeToolCursor.background,
            transform: `translate3d(${mousePosition.x - activeToolCursor.size / 2}px, ${mousePosition.y - activeToolCursor.size / 2}px, 0)`,
            willChange: "transform",
          }}
        />
      )}

      {settings.showKeyDisplay && displayId === settings.keyDisplayId && (
        <div
          className={`fixed flex flex-col ${POSITION_CLASSES[settings.keyDisplayPosition]}`}
          style={{ zIndex: 4 }}
        >
          {keyPresses.map((keyPress, index) => (
            <div
              key={`${keyPress.timestamp}-${index}`}
              className="mb-2 rounded px-3 py-1"
              style={{
                backgroundColor: settings.keyDisplayBackgroundColor,
                color: settings.keyDisplayTextColor,
                fontSize: settings.keyDisplayFontSize,
                textAlign: settings.keyDisplayPosition.includes("left")
                  ? "left"
                  : "right",
              }}
            >
              {formatKeyPress(keyPress)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
