import type { ReactNode } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import {
  AppShell,
  Anchor,
  Avatar,
  Badge,
  Burger,
  Button,
  Divider,
  Group,
  NavLink,
  Stack,
  Text,
  ThemeIcon,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { Compass, Search, Bookmark, Users, UserRound, Film } from "lucide-react";
import { useEntities } from "../state";

const destinations = [
  { to: "/", icon: Compass, label: "Discover", color: "yellow" },
  { to: "/search", icon: Search, label: "Search", color: "cyan" },
  { to: "/lists", icon: Bookmark, label: "Lists", color: "violet" },
  { to: "/activity", icon: Users, label: "Activity", color: "pink" },
  { to: "/profile", icon: UserRound, label: "Profile", color: "teal" },
] as const;

export default function Navigation({ userId, children }: { userId: string; children: ReactNode }) {
  const [opened, { toggle, close }] = useDisclosure();
  const pathname = useLocation({ select: (location) => location.pathname });
  const users = useEntities("user"),
    invitations = useEntities("invitation");
  const user = users.find((u) => u.id === userId);
  const pending = invitations.filter(
    (i) => i.data.userId === userId && i.data.state === "pending",
  ).length;
  const active = (to: string) => (to === "/" ? pathname === to : pathname.startsWith(to));
  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{ width: 224, breakpoint: "sm", collapsed: { mobile: !opened } }}
      footer={{ height: { base: 68, sm: 0 } }}
      padding={{ base: "md", sm: "xl" }}
    >
      <Anchor
        href="#main-content"
        className="skip-link"
        pos="fixed"
        top="var(--mantine-spacing-sm)"
        left="var(--mantine-spacing-sm)"
        bg="dark.6"
        p="xs"
      >
        Skip to content
      </Anchor>
      <AppShell.Header bg="dark.8">
        <Group h="100%" px={{ base: "md", sm: "xl" }} justify="space-between">
          <Group gap="sm">
            <Burger
              opened={opened}
              onClick={toggle}
              hiddenFrom="sm"
              size="sm"
              aria-label="Toggle navigation"
              aria-controls="main-navigation"
            />
            <Anchor
              renderRoot={(props) => <Link {...props} to="/" />}
              c="inherit"
              underline="never"
            >
              <Group gap="xs">
                <ThemeIcon variant="filled" color="yellow" size="lg">
                  <Text component="span" size="xl" lh={1} aria-hidden="true">
                    🍿
                  </Text>
                </ThemeIcon>
                <Text fw={800} size="lg">
                  MovieFinder
                </Text>
              </Group>
            </Anchor>
          </Group>
          <Group gap="md">
            <Button
              renderRoot={(props) => <Link {...props} to="/search" />}
              visibleFrom="md"
              variant="default"
              size="sm"
              leftSection={<Search size={16} />}
            >
              Search movies & people
            </Button>
            <Avatar
              renderRoot={(props) => <Link {...props} to="/profile" />}
              size="sm"
              color="violet"
              variant="filled"
              aria-label="Your profile"
            >
              {user?.title[0] ?? "U"}
            </Avatar>
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar
        p="md"
        bg="dark.8"
        id="main-navigation"
        visibleFrom={opened ? undefined : "sm"}
      >
        <AppShell.Section grow component="nav" aria-label="Main navigation">
          <Stack gap="xs">
            <Group gap="xs" px="sm" py="md" c="dimmed" wrap="nowrap">
              <Film size={16} aria-hidden="true" />
              <Text size="xs" fw={600}>
                Movies, TV & people
              </Text>
            </Group>
            {destinations.map(({ to, icon: Icon, label, color }) => (
              <NavLink
                key={to}
                renderRoot={(props) => <Link {...props} to={to} onClick={close} />}
                label={label}
                leftSection={
                  <ThemeIcon color={color} variant={active(to) ? "filled" : "light"} size="md">
                    <Icon size={16} aria-hidden="true" />
                  </ThemeIcon>
                }
                color={color}
                active={active(to)}
                py="sm"
                bdrs="xl"
                aria-current={active(to) ? "page" : undefined}
                rightSection={
                  to === "/activity" && pending ? (
                    <Badge size="sm" w="4rem">
                      <Text component="span" inherit ff="monospace" w="4ch" ta="left">
                        {pending}
                      </Text>
                    </Badge>
                  ) : undefined
                }
              />
            ))}
          </Stack>
        </AppShell.Section>
        <AppShell.Section pt="md">
          <Divider mb="md" variant="dashed" color="violet.7" />
          <NavLink
            renderRoot={(props) => <Link {...props} to="/profile" onClick={close} />}
            label={user?.title ?? "Account"}
            description="Account"
            leftSection={<Avatar size="sm">{user?.title[0] ?? "U"}</Avatar>}
          />
        </AppShell.Section>
      </AppShell.Navbar>
      {children}
      <AppShell.Footer hiddenFrom="sm" bg="dark.8">
        <Group component="nav" aria-label="Mobile navigation" h="100%" gap={0} grow>
          {destinations.map(({ to, icon: Icon, label, color }) => (
            <Anchor
              renderRoot={(props) => <Link {...props} to={to} />}
              key={to}

              aria-label={label}
              aria-current={active(to) ? "page" : undefined}
              c={active(to) ? `${color}.3` : "dimmed"}
              underline="never"
              py="xs"
              onClick={close}
            >
              <Stack gap={0} align="center">
                <ThemeIcon color={color} variant={active(to) ? "filled" : "transparent"} size="md">
                  <Icon size={18} aria-hidden="true" />
                </ThemeIcon>
                <Text size="xs" fw={active(to) ? 600 : 400}>
                  {label}
                </Text>
              </Stack>
            </Anchor>
          ))}
        </Group>
      </AppShell.Footer>
    </AppShell>
  );
}
