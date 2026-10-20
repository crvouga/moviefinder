import { createAuthClient } from "better-auth/react";
import { usernameClient } from "better-auth/client/plugins";
export const authClient = createAuthClient({
  plugins: [usernameClient()],
  // The session cookie is the source of truth; refetching on every window focus is a wasted trip.
  sessionOptions: { refetchOnWindowFocus: false },
});
