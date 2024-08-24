import { Route, BrowserRouter as Router, Routes } from "react-router-dom";

import Controller from "@/components/Controller";
import { Overlay } from "@/components/overlay-component";

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Controller />} />
        <Route path="/overlay" element={<Overlay />} />
      </Routes>
    </Router>
  );
}

export default App;
