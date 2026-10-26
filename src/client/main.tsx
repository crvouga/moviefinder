import { createRoot } from "react-dom/client";
import "@mantine/core/styles.css";
import "@mantine/dates/styles.css";
import "@mantine/notifications/styles.css";
import "swiper/css";
import "./interactions.css";
import { App } from "./app";
import { Providers } from "./providers";
import { installTelemetry } from "./telemetry";
installTelemetry();
createRoot(document.getElementById("root")!).render(
  <Providers>
    <App />
  </Providers>,
);
