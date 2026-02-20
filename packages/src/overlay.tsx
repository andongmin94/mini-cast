import ReactDOM from "react-dom/client";

import "@/bridge/native";
import "@/globals.css";

import Overlay from "@/components/Overlay";

ReactDOM.createRoot(document.getElementById("overlay-root")!).render(
  <Overlay />,
);
