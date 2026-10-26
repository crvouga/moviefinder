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
import { ArrowLeft } from "lucide-react";
import {
  Alert,
  Group,
  Anchor,
  AppShell,
  Button,
  Center,
  Container,
  Skeleton,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
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
import { ActivityPage, ProfilePage, ProfileHeader } from "./pages/social";
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
        <Suspense fallback={<RoutePlaceholder />}>
          <Outlet />
        </Suspense>
        <Toast />
      </>
    );
  if (!session.data)
    return (
      <Center mih="100dvh">
        <Stack align="center" gap="md">
          <ThemeIcon variant="light" size="xl">
            <Text component="span" size="xl" lh={1} aria-hidden="true">
              🍿
            </Text>
          </ThemeIcon>
          <Title order={1}>MovieFinder</Title>
          <Text c="dimmed" role="status">
            {session.isPending ? "Restoring session…" : "Sign in to continue."}
          </Text>
          {session.isPending && <Skeleton h="var(--mantine-spacing-sm)" w="10rem" />}
        </Stack>
      </Center>
    );
  return (
    <ViewerProvider userId={session.data.user.id}>
      <Navigation userId={session.data.user.id}>
        <MainContent />
      </Navigation>
      <Toast />
    </ViewerProvider>
  );
}
function RoutePlaceholder() {
  return (
    <Stack aria-label="Opening this page" aria-busy="true">
      <Skeleton h="var(--mantine-spacing-xl)" w="60%" />
      <Skeleton h="var(--mantine-spacing-sm)" w="40%" />
    </Stack>
  );
}
// Only the outlet and active navigation subscribe to pathname changes. Opening a route must
// not rerun the app-wide collection queries and indexes in ViewerProvider.
function MainContent() {
  const pathname = useLocation({ select: (location) => location.pathname });
  return (
    <AppShell.Main id="main-content" data-route={pathname} tabIndex={-1}>
      <Container>
        <Suspense key={pathname} fallback={<RoutePlaceholder />}>
          <Profiled id="screen">
            <Outlet />
          </Profiled>
        </Suspense>
      </Container>
    </AppShell.Main>
  );
}

function useCurrentUser() {
  return authClient.useSession().data?.user.id ?? "";
}
function PageScreen({ children }: { children: React.ReactNode }) {
  const pathname = useLocation({ select: (location) => location.pathname });
  const userId = useCurrentUser();
  const segments = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const title =
    segments[0] === "lists"
      ? segments[1]
        ? (collections.list.get(segments[1])?.title ?? "List")
        : "Lists"
      : segments[0] === "profile"
        ? (collections.user.get(segments[1] ?? userId)?.title ?? "Profile")
        : segments[0] === "activity"
          ? "Activity"
          : segments[0] === "search"
            ? "Search"
            : "Discover";
  return (
    <Screen
      preview={
        <Stack data-screen-preview aria-busy="true" gap="lg">
          {segments[0] === "profile" ? (
            <ProfileHeader
              user={collections.user.get(segments[1] ?? userId)}
              own={!segments[1] || segments[1] === userId}
            />
          ) : (
            <>
              {segments[0] === "lists" && segments[1] && (
                <Anchor renderRoot={(props) => <Link {...props} to="/lists" />}>
                  <Group gap="xs">
                    <ArrowLeft size={16} />
                    Back to lists
                  </Group>
                </Anchor>
              )}
              <PageHeading title={title} />
            </>
          )}
          <RoutePlaceholder />
        </Stack>
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
    <Stack>
      <PageHeading title="Page not found" />
      <Text c="dimmed">The requested page does not exist.</Text>
      <Anchor renderRoot={(props) => <Link {...props} to="/" />}>Back to Discover</Anchor>
    </Stack>
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
    <Stack>
      <PageHeading title="Unable to open page" />
      <Alert color="red" title="Page error">
        Please try again.
      </Alert>
      <Button onClick={() => void currentRouter.invalidate()}>Try again</Button>
      <Anchor renderRoot={(props) => <Link {...props} to="/" />}>Back to Discover</Anchor>
    </Stack>
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
