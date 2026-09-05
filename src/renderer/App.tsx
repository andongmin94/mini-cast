import Controller from "@/renderer/components/Controller";
import Overlay from "@/renderer/components/Overlay";

export default function App() {
  return window.location.hash === "#/overlay" ? <Overlay /> : <Controller />;
}
