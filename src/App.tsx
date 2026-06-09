import { HashRouter, Route, Routes } from "react-router-dom";

import Controller from "@/components/Controller";
import Overlay from "@/components/Overlay";

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Controller />} />
        <Route path="/overlay" element={<Overlay />} />
      </Routes>
    </HashRouter>
  );
}
