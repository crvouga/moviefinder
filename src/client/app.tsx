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
import { collections, startSync, stopSync } from "./state";
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
import { Screen } from "./components/screen";
import { PageHeading } from "./components/common";
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
  const isAuth = useLocation({ select: (location) => location.pathname.startsWith("/auth") }),
    navigate = useNavigate(),
    session = authClient.useSession();
  useEffect(() => {
    if (!session.isPending) rememberUser(session.data?.user.id);
  }, [session.isPending, session.data?.user.id]);
  useEffect(() => {
    if (!isAuth && !session.isPending && !session.data)
      void navigate({
        to: "/auth",
        search: { returnTo: router.state.location.href },
        replace: true,
      });
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
        <MainContent />
        <Toast />
      </div>
    </ViewerProvider>
  );
}
// Only the outlet and active navigation subscribe to pathname changes. Opening a route must
// not rerun the app-wide collection queries and indexes in ViewerProvider.
function MainContent() {
  const pathname = useLocation({ select: (location) => location.pathname });
  return (
    <main className="app-main" id="main-content" data-route={pathname}>
      <Suspense
        key={pathname}
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
  );
}
function useCurrentUser() {
  return authClient.useSession().data?.user.id ?? "";
}
function PageScreen({ children }: { children: React.ReactNode }) {
  const pathname = useLocation({ select: (location) => location.pathname });
  const userId = useCurrentUser();
  const segments = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const [eyebrow, title] =
    segments[0] === "lists"
      ? segments[1]
        ? [
            "A LITTLE COLLECTION OF GOOD STORIES",
            collections.list.get(segments[1])?.title ?? "Collection",
          ]
        : ["GOOD TASTE IS BETTER SHARED", "A list for every kind of night."]
      : segments[0] === "profile"
        ? [
            "A LIFE IN GOOD STORIES",
            collections.user.get(segments[1] ?? userId)?.title ?? "Movie lover",
          ]
        : segments[0] === "activity"
          ? ["A SHARED LOVE OF STORIES", "In good company."]
          : segments[0] === "search"
            ? ["FOLLOW YOUR CURIOSITY", "What are you in the mood for?"]
            : ["A GOOD NIGHT STARTS HERE", "Find your next obsession."];
  return (
    <Screen
      preview={
        <div className="standard-page" data-screen-preview aria-busy="true">
          {segments[0] === "lists" && segments[1] && <Link to="/lists">Back to collections</Link>}
          <PageHeading eyebrow={eyebrow!} title={title!} />
          <div className="skeleton-line wide" />
          <div className="skeleton-line" />
        </div>
      }
    >
      {children}
    </Screen>
  );
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
  component: () => (
    <PageScreen>
      <Discover userId={useCurrentUser()} />
    </PageScreen>
  ),
});
const auth = createRoute({ getParentRoute: () => root, path: "/auth", component: AuthPage });
const search = createRoute({
  getParentRoute: () => root,
  path: "/search",
  component: () => (
    <PageScreen>
      <SearchPage />
    </PageScreen>
  ),
});
const lists = createRoute({
  getParentRoute: () => root,
  path: "/lists",
  component: () => (
    <PageScreen>
      <ListsPage userId={useCurrentUser()} />
    </PageScreen>
  ),
});
const list = createRoute({
  getParentRoute: () => root,
  path: "/lists/$listId",
  component: () => (
    <PageScreen>
      <ListDetail userId={useCurrentUser()} />
    </PageScreen>
  ),
});
const detail = createRoute({
  getParentRoute: () => root,
  path: "/title/$id",
  component: () => <DetailPage userId={useCurrentUser()} />,
});
const activity = createRoute({
  getParentRoute: () => root,
  path: "/activity",
  component: () => (
    <PageScreen>
      <ActivityPage userId={useCurrentUser()} />
    </PageScreen>
  ),
});
const profile = createRoute({
  getParentRoute: () => root,
  path: "/profile",
  component: () => (
    <PageScreen>
      <ProfilePage currentUserId={useCurrentUser()} />
    </PageScreen>
  ),
});
const publicProfile = createRoute({
  getParentRoute: () => root,
  path: "/profile/$userId",
  component: () => (
    <PageScreen>
      <ProfilePage currentUserId={useCurrentUser()} />
    </PageScreen>
  ),
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
