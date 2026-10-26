import { useEffect } from "react";
import { notifications } from "@mantine/notifications";
import { notices } from "../notifications";

// Keep command transport independent of the rendered notification system.
export function Toast() {
  useEffect(() => {
    const show = (event: Event) =>
      notifications.show({
        message: (event as CustomEvent<string>).detail,
        autoClose: 6000,
        withCloseButton: true,
        role: "status",
      });
    notices.addEventListener("notice", show);
    return () => notices.removeEventListener("notice", show);
  }, []);
  return null;
}
