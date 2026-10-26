import type { ReactNode } from "react";
import {
  Divider,
  Group,
  Paper,
  ScrollArea,
  Skeleton,
  Stack,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { Ticket } from "lucide-react";

// An asynchronous section owns its scroll viewport. Incoming rows, empty/error
// feedback and metadata must never resize sections that follow it.
export function DataSection({
  title,
  children,
  height = "24rem",
}: {
  title: string;
  children?: ReactNode;
  height?: string;
}) {
  return (
    <Stack component="section" gap="md" data-data-section={title}>
      <Group mih="2rem">
        <ThemeIcon size="md" color="violet" variant="light" visibleFrom="xs" aria-hidden="true">
          <Ticket size={17} />
        </ThemeIcon>
        <Title order={2}>{title}</Title>
        <Divider flex={1} variant="dashed" color="violet.6" />
      </Group>
      <Paper withBorder p="md" bg="dark.8">
        <ScrollArea
          h={height}
          viewportProps={{ role: "region", "aria-label": `${title} content`, tabIndex: 0 }}
        >
          {children === undefined ? (
            <Stack aria-busy="true">
              <Skeleton h="var(--mantine-spacing-sm)" w="60%" />
              <Skeleton h="var(--mantine-spacing-sm)" w="85%" />
            </Stack>
          ) : (
            children
          )}
        </ScrollArea>
      </Paper>
    </Stack>
  );
}
