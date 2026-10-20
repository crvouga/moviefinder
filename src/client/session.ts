import { authClient } from "./auth-client";

// Route loaders need the signed-in user on every navigation. Asking the server each time cost a
// round trip per page, so the answer is kept until authentication changes.
let known: Promise<string | undefined> | undefined;
export function currentUserId() {
  return (known ??= authClient
    .getSession()
    .then((result) => result.data?.user.id)
    .catch(() => {
      known = undefined;
      return undefined;
    }));
}
// Called with what the session hook reports, which is always at least as fresh.
export function rememberUser(userId: string | undefined) {
  known = userId ? Promise.resolve(userId) : undefined;
}
