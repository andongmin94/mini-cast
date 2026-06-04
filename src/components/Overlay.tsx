import CursorLayer from "@/components/overlay/CursorLayer";
import KeyDisplayLayer from "@/components/overlay/KeyDisplayLayer";
import { useOverlayEvents } from "@/components/overlay/useOverlayEvents";

export default function Overlay() {
  const { settings, mousePosition, keyPresses, displayId, mouseButtons } =
    useOverlayEvents();

  return (
    <div className="pointer-events-none fixed inset-0" style={{ zIndex: 9999 }}>
      <CursorLayer
        settings={settings}
        mousePosition={mousePosition}
        mouseButtons={mouseButtons}
      />
      <KeyDisplayLayer
        settings={settings}
        keyPresses={keyPresses}
        displayId={displayId}
      />
    </div>
  );
}
