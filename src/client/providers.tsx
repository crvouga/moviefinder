import type { ReactNode } from "react";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { DatesProvider } from "@mantine/dates";
import { theme, cssVariablesResolver } from "./theme";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <MantineProvider
      theme={theme}
      cssVariablesResolver={cssVariablesResolver}
      forceColorScheme="dark"
    >
      <DatesProvider settings={{ locale: "en", firstDayOfWeek: 0 }}>
        {children}
        <Notifications
          position="top-right"
          mt="var(--app-shell-header-height, 0rem)"
          layout="stacked"
          transitionDuration={0}
          limit={3}
        />
      </DatesProvider>
    </MantineProvider>
  );
}
