import { type KeyDisplayPosition } from "@/components/settings/types";
import { type KeyPress } from "@/components/overlay/types";

function isMouseKey(key: string) {
  return key === "Mouse left" || key === "Mouse right" || key === "Mouse middle";
}

export function shouldRenderKeyPress(keyPress: KeyPress) {
  return !isMouseKey(keyPress.key);
}

export function getPositionClasses(position: KeyDisplayPosition) {
  switch (position) {
    case "top-left":
      return "top-4 left-4 items-start";
    case "top-right":
      return "top-4 right-4 items-end";
    case "bottom-left":
      return "bottom-4 left-4 items-start";
    case "bottom-right":
      return "bottom-4 right-4 items-end";
    default:
      return "bottom-4 right-4 items-end";
  }
}

export function formatKeyPressText(keyPress: KeyPress) {
  const keyLabel =
    keyPress.key === "Mouse left"
      ? "좌클릭"
      : keyPress.key === "Mouse right"
        ? "우클릭"
        : keyPress.key === "Mouse middle"
          ? "휠"
          : keyPress.key !== "Control" &&
              keyPress.key !== "Shift" &&
              keyPress.key !== "Alt" &&
              keyPress.key !== "Meta" &&
              keyPress.key;

  return [
    keyPress.ctrlKey && "Ctrl",
    keyPress.shiftKey && "Shift",
    keyPress.altKey && "Alt",
    keyPress.metaKey && "Meta",
    keyLabel,
  ]
    .filter(Boolean)
    .join(" + ");
}
