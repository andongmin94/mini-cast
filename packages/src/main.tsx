import ReactDOM from "react-dom/client";

import "@/bridge/native";

import App from "./App.tsx";

import "@/globals.css";

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
