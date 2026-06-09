import { type KeyPress } from "@/components/overlay/types";
import { type KeyDisplayPosition } from "@/components/settings/types";

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
