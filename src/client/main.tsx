import { createRoot } from "react-dom/client";
import { App } from "./app";
import "./styles.css";
import { installTelemetry } from "./telemetry";
installTelemetry();
createRoot(document.getElementById("root")!).render(<App />);
