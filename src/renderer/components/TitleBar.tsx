import type { CSSProperties } from "react";
import { Minus, X } from "lucide-react";

import MiniCastLogo from "/logo.svg";

const drag = { WebkitAppRegion: "drag" } as CSSProperties;
const noDrag = { WebkitAppRegion: "no-drag" } as CSSProperties;

export default function TitleBar() {
  if (typeof miniCast === "undefined") return <div className="h-10" />;

  return (
    <div
      className="flex h-10 w-full items-center justify-between bg-neutral-800 text-white"
      style={drag}
    >
      <div className="flex items-center gap-2 pl-2">
        <img src={MiniCastLogo} alt="" className="size-6" />
        <span className="text-lg">미니캐스트</span>
      </div>
      <div className="flex h-full" style={noDrag}>
        <button
          type="button"
          onClick={() => miniCast.minimizeWindow()}
          className="grid w-10 place-items-center hover:bg-neutral-700"
          aria-label="최소화"
        >
          <Minus className="size-5" />
        </button>
        <button
          type="button"
          onClick={() => miniCast.hideWindow()}
          className="grid w-10 place-items-center hover:bg-red-600"
          aria-label="닫기"
        >
          <X className="size-5" />
        </button>
      </div>
    </div>
  );
}
