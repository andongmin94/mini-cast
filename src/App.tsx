import Controller from "@/components/Controller";
import Overlay from "@/components/Overlay";

export default function App() {
  return window.location.hash === "#/overlay" ? <Overlay /> : <Controller />;
}
