import type { AnnotationCommand, AnnotationTool } from "./contract.js";

export interface ToolShortcut {
  accelerator: string;
  inputCombination: string;
  tool: AnnotationTool;
}

export interface CommandShortcut {
  accelerator: string;
  command: AnnotationCommand;
}

export const TOOL_SHORTCUTS: readonly ToolShortcut[] = [
  {
    accelerator: "Alt+Shift+1",
    inputCombination: "Shift + Alt + 1",
    tool: "pass-through",
  },
  {
    accelerator: "Alt+Shift+3",
    inputCombination: "Shift + Alt + 3",
    tool: "pen",
  },
  {
    accelerator: "Alt+Shift+4",
    inputCombination: "Shift + Alt + 4",
    tool: "highlighter",
  },
  {
    accelerator: "Alt+Shift+5",
    inputCombination: "Shift + Alt + 5",
    tool: "eraser",
  },
];

export const ACTIVE_COMMAND_SHORTCUTS: readonly CommandShortcut[] = [
  { accelerator: "CommandOrControl+Z", command: "undo" },
  { accelerator: "CommandOrControl+Shift+Z", command: "redo" },
  { accelerator: "Alt+Shift+6", command: "undo" },
  { accelerator: "Alt+Shift+7", command: "clear" },
];

export const ESCAPE_SHORTCUT = "Escape";

export const INTERNAL_INPUT_COMBINATIONS = new Set([
  ...TOOL_SHORTCUTS.map((shortcut) => shortcut.inputCombination),
  "Esc",
  "Ctrl + Z",
  "Ctrl + Shift + Z",
  "Shift + Alt + 6",
  "Shift + Alt + 7",
]);
