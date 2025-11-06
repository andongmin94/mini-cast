import { screen } from "electron";
import { GlobalKeyboardListener } from "node-global-key-listener";

import { overlayWindows } from "./window.js";

export let mouseEventInterval: any;
export function captureMouseEvents() {
  mouseEventInterval = setInterval(() => {
    const cursorPosition = screen.getCursorScreenPoint();
    const activeDisplay = screen.getDisplayNearestPoint(cursorPosition);

    overlayWindows.forEach((window: any, index: any) => {
      const display = screen.getAllDisplays()[index];
      if (display.id === activeDisplay.id) {
        const localPosition = {
          x: cursorPosition.x - display.bounds.x,
          y: cursorPosition.y - display.bounds.y,
        };
        window.webContents.send("mouse-move", localPosition);
      } else {
        window.webContents.send("mouse-move", null);
      }
    });
  }, 8);
}

export function captureKeyboardEvents() {
  const gkl = new GlobalKeyboardListener();
  const specialKeys: any = {
    ctrl: false,
    shift: false,
    alt: false,
    meta: false,
  };
  // let capsLockOn = false;
  let lastCombination = "";
  let lastTimestamp = 0;

  const keyNameMap = {
    "LEFT CTRL": "Ctrl",
    "RIGHT CTRL": "Ctrl",
    "LEFT SHIFT": "Shift",
    "RIGHT SHIFT": "Shift",
    "LEFT ALT": "Alt",
    "RIGHT ALT": "Alt",
    "LEFT META": "Meta",
    "RIGHT META": "Meta",
    ESCAPE: "Esc",
    RETURN: "Enter",
    "BACK SPACE": "Backspace",
    "CAPS LOCK": "CapsLock",
    SPACE: "Space",
    TAB: "Tab",
    "UP ARROW": "↑",
    "DOWN ARROW": "↓",
    "LEFT ARROW": "←",
    "RIGHT ARROW": "→",
    PERIOD: ".",
    COMMA: ",",
    SEMICOLON: ";",
    "FORWARD SLASH": "/",
    "BACK SLASH": "\\",
    EQUAL: "=",
    MINUS: "-",
    "OPEN BRACKET": "[",
    "CLOSE BRACKET": "]",
    QUOTE: "'",
    "BACK QUOTE": "`",
  };

  function getKeyName(name: any) {
    if (Object.prototype.hasOwnProperty.call(keyNameMap, name)) {
      return keyNameMap[name as keyof typeof keyNameMap];
    }
    if (name.length === 1) {
      return name;
    return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  }

  function sendKeyPress(combination: any, keyDetails: any) {
    const currentTime = Date.now();
    if (combination !== lastCombination || currentTime - lastTimestamp > 200) {
      overlayWindows.forEach((window: any, index: any) => {
        window.webContents.send("key-press", {
          ...keyDetails,
          displayId: index,
          combination,
        });
      });
      lastCombination = combination;
      lastTimestamp = currentTime;
    }
  }

  gkl.addListener((e) => {
    const rawName = (e.name ?? "").trim();
    if (!rawName) {
      return;
    }

    const isSpecialKey = [
      "LEFT CTRL",
      "RIGHT CTRL",
      "LEFT SHIFT",
      "RIGHT SHIFT",
      "LEFT ALT",
      "RIGHT ALT",
      "LEFT META",
      "RIGHT META",
      "CAPS LOCK",
    ].includes(rawName);

    // if (e.name === 'CAPS LOCK' && e.state === 'DOWN') {
    //   capsLockOn = !capsLockOn;
    // }

    const keyName = getKeyName(rawName);
    if (
      rawName === "MOUSE LEFT" ||
      rawName === "MOUSE MIDDLE" ||
      rawName === "MOUSE RIGHT"
    ) {
      overlayWindows.forEach((window: any) => {
        window.webContents.send(rawName + " " + e.state);
      });
    }

    if (isSpecialKey && rawName !== "CAPS LOCK") {
      specialKeys[keyName.toLowerCase()] = e.state === "DOWN";
    }

    if (e.state === "DOWN" && !isSpecialKey) {
      const specialKeyCombination = [];
      if (specialKeys.ctrl) specialKeyCombination.push("Ctrl");
      if (specialKeys.shift) specialKeyCombination.push("Shift");
      if (specialKeys.alt) specialKeyCombination.push("Alt");
      if (specialKeys.meta) specialKeyCombination.push("Meta");

      let combination = keyName;
      if (specialKeyCombination.length > 0) {
        combination = `${specialKeyCombination.join(" + ")} + ${keyName}`;
      }

      const displayKey = keyName;
      // // if (keyName.length === 1 && keyName >= 'A' && keyName <= 'Z') {
      // //   const shouldBeUpperCase = (capsLockOn && !specialKeys.shift) || (!capsLockOn && specialKeys.shift);
      // //   displayKey = shouldBeUpperCase ? keyName : keyName.toLowerCase();
      // // }

      // const keyDetails = {
      //   key: displayKey,
      //   code: e.rawKey._nameRaw,
      //   ctrlKey: specialKeys.ctrl,
      //   shiftKey: specialKeys.shift,
      //   altKey: specialKeys.alt,
      //   metaKey: specialKeys.meta,
      //   // capsLock: capsLockOn,
      //   timestamp: Date.now()
      // };

      // sendKeyPress(combination.replace(keyName, displayKey), keyDetails);

      // 단일 알파벳 키인지 확인하는 함수
      function isSingleAlphabet(key: any) {
        return (
          /^[a-zA-Z]$/.test(key) &&
          !specialKeys.ctrl &&
          !specialKeys.shift &&
          !specialKeys.alt &&
          !specialKeys.meta
        );
      }

      // keyDetails 생성 전에 필터링
      if (!isSingleAlphabet(displayKey)) {
        const keyDetails = {
          key: displayKey,
          code: e.rawKey ? e.rawKey._nameRaw : "",
          ctrlKey: specialKeys.ctrl,
          shiftKey: specialKeys.shift,
          altKey: specialKeys.alt,
          metaKey: specialKeys.meta,
          timestamp: Date.now(),
        };
        sendKeyPress(combination.replace(keyName, displayKey), keyDetails);
      }
    }
  });
}

export function getConnectedDisplays() {
  return screen.getAllDisplays().map((display, index) => ({
    id: display.id,
    name: `모니터 ${index + 1}`,
    bounds: display.bounds,
  }));
}
