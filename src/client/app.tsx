import { parseSearch, stringifySearch } from "../shared/search";
import { useEffect, lazy, Suspense, Profiler, type ProfilerOnRenderCallback } from "react";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  useLocation,
  useNavigate,
  RouterProvider,
} from "@tanstack/react-router";
import { Film } from "lucide-react";
import { authClient } from "./auth-client";
import { currentUserId, rememberUser } from "./session";
import { report } from "./notifications";
import { screenModules } from "./screen-modules";
import { Toast } from "./components/toast";
import { ViewerProvider } from "./components/viewer";
import { track, telemetryEnabled } from "./telemetry";

const commit: ProfilerOnRenderCallback = (id, phase, actual, base) => {
  if (actual >= 8)
    track("render", id, {
      phase,
      ms: Math.round(actual * 10) / 10,
      base: Math.round(base),
      path: location.pathname,
    });
};
function Profiled({ id, children }: { id: string; children: React.ReactNode }) {
  return telemetryEnabled ? (
    <Profiler id={id} onRender={commit}>
      {children}
    </Profiler>
  ) : (
    children
  );
}

const Navigation = lazy(() => import("./components/navigation"));
let stateModule: Promise<typeof import("./state")> | undefined;
const AuthPage = lazy(() => import("./pages/auth").then((m) => ({ default: m.AuthPage })));
const Discover = lazy(() => screenModules.discover().then((m) => ({ default: m.Discover })));
const DetailPage = lazy(() => screenModules.details().then((m) => ({ default: m.DetailPage })));
const SearchPage = lazy(() => screenModules.search().then((m) => ({ default: m.SearchPage })));
const ListsPage = lazy(() => screenModules.lists().then((m) => ({ default: m.ListsPage })));
const ListDetail = lazy(() => screenModules.lists().then((m) => ({ default: m.ListDetail })));
const ActivityPage = lazy(() => screenModules.social().then((m) => ({ default: m.ActivityPage })));
const ProfilePage = lazy(() => screenModules.social().then((m) => ({ default: m.ProfilePage })));
function Root() {
  const location = useLocation(),
    navigate = useNavigate(),
    session = authClient.useSession(),
    isAuth = location.pathname.startsWith("/auth");
  useEffect(() => {
    if (!session.isPending) rememberUser(session.data?.user.id);
  }, [session.isPending, session.data?.user.id]);
  useEffect(() => {
    if (!isAuth && !session.isPending && !session.data)
      void navigate({ to: "/auth", search: { returnTo: location.href }, replace: true });
  }, [session.isPending, session.data, isAuth]);
  useEffect(() => {
    if (session.data && !isAuth) {
      stateModule ??= import("./state");
      void stateModule.then((m) => m.startSync(session.data!.user.id)).catch(report);
    }
    if (isAuth && stateModule) void stateModule.then((m) => m.stopSync());
  }, [session.data?.user.id, isAuth]);
  useEffect(() => {
    if (!session.data || isAuth) return;
    let dispose: (() => void) | undefined;
    let live = true;
    void import("./preloading")
      .then((m) => {
        if (live) dispose = m.startNavigationPreloading(session.data!.user.id);
      })
      .catch(report);
    return () => {
      live = false;
      dispose?.();
    };
  }, [session.data?.user.id, isAuth]);
  if (isAuth)
    return (
      <>
        <Suspense
          fallback={
            <div className="route-placeholder" aria-label="Opening this page">
              <div className="skeleton-line wide" />
              <div className="skeleton-line" />
            </div>
          }
        >
          <Outlet />
        </Suspense>
        <Toast />
      </>
    );
  if (!session.data)
    return (
      <main className="session-restoration">
        <span className="brand-icon">
          <Film size={25} />
        </span>
        <h1>moviefinder.</h1>
        <p>
          {session.isPending
            ? "Getting your seat ready."
            : "Your next good story starts with signing in."}
        </p>
      </main>
    );
  return (
    <ViewerProvider userId={session.data.user.id}>
      <div className="app-shell">
        <Suspense
          fallback={
            <div className="mobile-header">
              <span className="brand">moviefinder.</span>
            </div>
          }
        >
          <Profiled id="navigation">
            <Navigation userId={session.data.user.id} />
          </Profiled>
        </Suspense>
        <main className="app-main" id="main-content">
          <Suspense
            fallback={
              <div className="route-placeholder" aria-label="Opening this page">
                <div className="skeleton-line wide" />
                <div className="skeleton-line" />
              </div>
            }
          >
            <Profiled id="screen">
              <Outlet />
            </Profiled>
          </Suspense>
        </main>
        <Toast />
      </div>
    </ViewerProvider>
  );
}
function useCurrentUser() {
  return authClient.useSession().data?.user.id ?? "";
}
const root = createRootRoute({
  component: Root,
  validateSearch: (search: Record<string, unknown>) => search,
  notFoundComponent: () => (
    <div className="standard-page">
      <h1>A story for another day.</h1>
      <p>This page couldn’t be found.</p>
      <Link to="/">Back to Discover</Link>
    </div>
  ),
});
async function loadScreen({
  location,
  abortController,
}: {
  location: { href: string };
  abortController: AbortController;
}) {
  const userId = await currentUserId();
  if (!userId || abortController.signal.aborted) return;
  try {
    const { prepareScreen } = await import("./preloading");
    await prepareScreen(location.href, userId, abortController.signal);
  } catch (error) {
    if (!abortController.signal.aborted) report(error);
  }
}
const home = createRoute({
  getParentRoute: () => root,
  path: "/",
  loader: loadScreen,
  component: () => <Discover userId={useCurrentUser()} />,
});
const auth = createRoute({ getParentRoute: () => root, path: "/auth", component: AuthPage });
const search = createRoute({
  getParentRoute: () => root,
  path: "/search",
  loader: loadScreen,
  component: SearchPage,
});
const lists = createRoute({
  getParentRoute: () => root,
  path: "/lists",
  loader: loadScreen,
  component: () => <ListsPage userId={useCurrentUser()} />,
});
const list = createRoute({
  getParentRoute: () => root,
  path: "/lists/$listId",
  loader: loadScreen,
  component: () => <ListDetail userId={useCurrentUser()} />,
});
const detail = createRoute({
  getParentRoute: () => root,
  path: "/title/$id",
  loader: loadScreen,
  component: () => <DetailPage userId={useCurrentUser()} />,
});
const activity = createRoute({
  getParentRoute: () => root,
  path: "/activity",
  loader: loadScreen,
  component: () => <ActivityPage userId={useCurrentUser()} />,
});
const profile = createRoute({
  getParentRoute: () => root,
  path: "/profile",
  loader: loadScreen,
  component: () => <ProfilePage currentUserId={useCurrentUser()} />,
});
const publicProfile = createRoute({
  getParentRoute: () => root,
  path: "/profile/$userId",
  loader: loadScreen,
  component: () => <ProfilePage currentUserId={useCurrentUser()} />,
});
export const router = createRouter({
  parseSearch,
  stringifySearch,
  routeTree: root.addChildren([
    home,
    auth,
    search,
    lists,
    list,
    detail,
    activity,
    profile,
    publicProfile,
  ]),
  scrollRestoration: true,
  defaultPreload: false,
  defaultPendingMs: 150,
  defaultPendingMinMs: 0,
});
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
if (telemetryEnabled) {
  let began = 0;
  router.subscribe("onBeforeNavigate", () => (began = performance.now()));
  router.subscribe("onResolved", (e) =>
    track("route", e.toLocation.pathname, {
      ms: began ? Math.round(performance.now() - began) : undefined,
    }),
  );
}
export function App() {
  return <RouterProvider router={router} />;
}
