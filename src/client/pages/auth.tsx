import { useEffect, useState } from "react";
import { useLocation } from "@tanstack/react-router";
import {
  Alert,
  Button,
  ScrollArea,
  Center,
  Container,
  Divider,
  Group,
  Image,
  Paper,
  Stack,
  Text,
  ThemeIcon,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { Clapperboard, Film, Popcorn, Ticket } from "lucide-react";
import { authClient } from "../auth-client";
import { safeReturnTo } from "../../shared/contracts";

export function AuthPage() {
  const location = useLocation();
  const params = new URLSearchParams(location.searchStr);
  const [availability, setAvailability] = useState<"checking" | "ready" | "unavailable">(
    "checking",
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    params.has("socialError") ? "We couldn’t complete your sign-in. Please try again." : "",
  );
  async function checkAvailability(signal?: AbortSignal) {
    setAvailability("checking");
    try {
      const response = await fetch("/api/auth-options", { signal });
      if (!response.ok) throw new Error("Unavailable");
      const options = await response.json();
      setAvailability(options.google === true ? "ready" : "unavailable");
    } catch {
      if (!signal?.aborted) setAvailability("unavailable");
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    void checkAvailability(controller.signal);
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) setBusy(false);
    };
    window.addEventListener("pageshow", restore);
    return () => window.removeEventListener("pageshow", restore);
  }, []);
  async function signInWithGoogle() {
    setBusy(true);
    setMessage("");
    try {
      const returnTo = safeReturnTo(params.get("returnTo"));
      const errorURL = new URL("/auth", window.location.origin);
      errorURL.searchParams.set("socialError", "1");
      errorURL.searchParams.set("returnTo", returnTo);
      const result = await authClient.signIn.social({
        provider: "auth-relay",
        callbackURL: returnTo,
        errorCallbackURL: errorURL.href,
      });
      if (result.error) throw new Error("Unavailable");
    } catch {
      setMessage("Google sign-in is unavailable right now. Please try again.");
      setBusy(false);
    }
  }
  return (
    <Center component="main" mih="100dvh" p="md">
      <Container size="xs" w="100%" px={0}>
        <Stack gap="xl">
          <Group justify="center" gap="sm">
            <ThemeIcon variant="filled" size="xl" color="yellow" radius="xl">
              <Text component="span" size="xl" lh={1} aria-hidden="true">
                🍿
              </Text>
            </ThemeIcon>
            <Text fw={900} size="xl">
              MovieFinder
            </Text>
          </Group>
          <Paper withBorder p={{ base: "lg", xs: "xl" }} radius="lg" shadow="lg">
            <Stack align="flex-start" gap="lg">
              <Group justify="space-between" w="100%" h="4rem" aria-hidden="true">
                <ThemeIcon variant="filled" color="yellow" radius="xl" size="xl">
                  <Popcorn size={26} />
                </ThemeIcon>
                <ThemeIcon
                  variant="gradient"
                  gradient={{ from: "violet", to: "pink", deg: 45 }}
                  radius="xl"
                  size="xl"
                >
                  <Clapperboard size={24} />
                </ThemeIcon>
                <ThemeIcon variant="light" color="pink" radius="xl" size="xl">
                  <Ticket size={24} />
                </ThemeIcon>
                <ThemeIcon variant="light" color="cyan" radius="xl" size="xl">
                  <Film size={24} />
                </ThemeIcon>
              </Group>
              <Divider w="100%" variant="dashed" color="violet.5" />
              <Group justify="space-between" w="100%">
                <Title order={1} id="auth-title">
                  Sign in
                </Title>
              </Group>
              <Text c="dimmed">
                Sign in to search titles, track watched movies and TV shows, and manage lists.
              </Text>
              <Divider w="100%" variant="dashed" color="violet.5" />
              <UnstyledButton
                type="button"
                aria-label="Sign in with Google"
                disabled={availability !== "ready" || busy}
                onClick={() => void signInWithGoogle()}
              >
                <Image src="/brand/google-signin-light.png" w={216} h={48} alt="" />
              </UnstyledButton>
              <ScrollArea h="10rem" w="100%">
                <Stack role="status" aria-live="polite" gap="xs">
                  {availability === "unavailable" ? (
                    <>
                      <Alert color="red">Sign-in is temporarily unavailable.</Alert>
                      <Button variant="default" onClick={() => void checkAvailability()}>
                        Try again
                      </Button>
                    </>
                  ) : message ? (
                    <Alert color="red">{message}</Alert>
                  ) : busy ? (
                    <Text c="dimmed">Opening Google…</Text>
                  ) : availability === "checking" ? (
                    <Text c="dimmed">Checking sign-in availability…</Text>
                  ) : null}
                </Stack>
              </ScrollArea>
              <Text size="sm" c="dimmed">
                An account is created on your first sign-in.
              </Text>
            </Stack>
          </Paper>
        </Stack>
      </Container>
    </Center>
  );
}
