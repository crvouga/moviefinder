import { parseSearch, stringifySearch } from "../shared/search";
import { useEffect, Suspense, Profiler, type ProfilerOnRenderCallback } from "react";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  useLocation,
  useNavigate,
  RouterProvider,
  useRouter,
} from "@tanstack/react-router";
import { Film } from "lucide-react";
import { authClient } from "./auth-client";
import { rememberUser } from "./session";
import { startSync, stopSync } from "./state";
import { startNavigationPreloading } from "./preloading";
import { report } from "./notifications";
import Navigation from "./components/navigation";
import { AuthPage } from "./pages/auth";
import { Discover } from "./pages/discover";
import { DetailPage } from "./pages/details";
import { SearchPage } from "./pages/search";
import { ListsPage, ListDetail } from "./pages/lists";
import { ActivityPage, ProfilePage } from "./pages/social";
import { Toast } from "./components/toast";
import { ViewerProvider } from "./components/viewer";
import { track, telemetryEnabled, beginNavigation, resolveNavigation } from "./telemetry";

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

// All route components are available before the app becomes interactive. Navigation never
// depends on downloading a screen chunk, data readiness, provider hydration or artwork.
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
    if (session.data && !isAuth) void startSync(session.data.user.id).catch(report);
    if (isAuth) stopSync();
  }, [session.data?.user.id, isAuth]);
  useEffect(() => {
    if (!session.data || isAuth) return;
    const preloading = startNavigationPreloading(session.data.user.id);
    const stopBefore = router.subscribe("onBeforeNavigate", preloading.pause);
    const stopAfter = router.subscribe("onResolved", preloading.resume);
    return () => {
      stopBefore();
      stopAfter();
      preloading();
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
        <main className="app-main" id="main-content" data-route={location.pathname}>
          <Suspense
            fallback={
              <div className="route-placeholder" aria-label="Opening this page">
                <div className="skeleton-line wide" />
                <div className="skeleton-line" />
              </div>
            }
          >
            <Profiled id="screen" key={location.pathname}>
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
const home = createRoute({
  getParentRoute: () => root,
  path: "/",
  component: () => <Discover userId={useCurrentUser()} />,
});
const auth = createRoute({ getParentRoute: () => root, path: "/auth", component: AuthPage });
const search = createRoute({
  getParentRoute: () => root,
  path: "/search",
  component: SearchPage,
});
const lists = createRoute({
  getParentRoute: () => root,
  path: "/lists",
  component: () => <ListsPage userId={useCurrentUser()} />,
});
const list = createRoute({
  getParentRoute: () => root,
  path: "/lists/$listId",
  component: () => <ListDetail userId={useCurrentUser()} />,
});
const detail = createRoute({
  getParentRoute: () => root,
  path: "/title/$id",
  component: () => <DetailPage userId={useCurrentUser()} />,
});
const activity = createRoute({
  getParentRoute: () => root,
  path: "/activity",
  component: () => <ActivityPage userId={useCurrentUser()} />,
});
const profile = createRoute({
  getParentRoute: () => root,
  path: "/profile",
  component: () => <ProfilePage currentUserId={useCurrentUser()} />,
});
const publicProfile = createRoute({
  getParentRoute: () => root,
  path: "/profile/$userId",
  component: () => <ProfilePage currentUserId={useCurrentUser()} />,
});
function ScreenError() {
  const currentRouter = useRouter();
  return (
    <div className="standard-page">
      <h1>This page couldn’t be opened.</h1>
      <p>Please try again shortly.</p>
      <button onClick={() => void currentRouter.invalidate()}>Try again</button>
      <Link to="/">Back to Discover</Link>
    </div>
  );
}
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
  // Route commitment has no asynchronous data or media prerequisites.
  defaultPendingMs: 0,
  defaultErrorComponent: ScreenError,
  defaultPendingMinMs: 0,
});
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
if (telemetryEnabled) {
  router.subscribe("onBeforeNavigate", (e) => beginNavigation(e.toLocation.href));
  router.subscribe("onResolved", (e) => resolveNavigation(e.toLocation.href));
}

export function App() {
  return <RouterProvider router={router} />;
}
