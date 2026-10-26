import { DateInput } from "@mantine/dates";
import {
  createTheme,
  ActionIcon,
  AppShell,
  ScrollArea,
  Button,
  Card,
  Container,
  Drawer,
  Modal,
  NativeSelect,
  NavLink,
  Paper,
  Select,
  Textarea,
  TextInput,
  NumberInput,
  Skeleton,
  Badge,
  ThemeIcon,
} from "@mantine/core";

// Mantine owns the palette, spacing, shadows and responsive breakpoints.
export const theme = createTheme({
  primaryColor: "yellow",
  primaryShade: 4,
  autoContrast: true,
  // Use the black/white contrast crossover for readable bright reaction pills.
  luminanceThreshold: 0.179,
  defaultRadius: "lg",
  defaultGradient: { from: "grape.6", to: "pink.6", deg: 135 },
  fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
  headings: {
    fontFamily: "inherit",
    fontWeight: "800",
    sizes: {
      h1: { fontSize: "2.125rem", lineHeight: "1.25" },
      h2: { fontSize: "1.25rem", lineHeight: "1.35" },
      h3: { fontSize: "1rem", lineHeight: "1.4" },
    },
  },
  respectReducedMotion: true,
  components: {
    NavLink: NavLink.extend({ defaultProps: { noWrap: true, variant: "light", fw: 600 } }),
    AppShell: AppShell.extend({ defaultProps: { offsetScrollbars: false } }),
    ScrollArea: ScrollArea.extend({
      classNames: { thumb: "stable-scroll-thumb" },
      defaultProps: {
        type: "always",
        scrollbars: "y",
        offsetScrollbars: "y",
        scrollbarSize: "var(--mantine-spacing-sm)",
      },
    }),
    ScrollAreaAutosize: ScrollArea.Autosize.extend({
      defaultProps: {
        type: "always",
        scrollbars: "y",
        offsetScrollbars: "y",
        scrollbarSize: "var(--mantine-spacing-sm)",
      },
    }),
    Button: Button.extend({ defaultProps: { size: "md", radius: "xl", fw: 700 } }),
    ActionIcon: ActionIcon.extend({
      defaultProps: { size: "xl", variant: "subtle", color: "gray.4", radius: "xl" },
    }),
    TextInput: TextInput.extend({ defaultProps: { size: "md", radius: "xl" } }),
    Textarea: Textarea.extend({ defaultProps: { size: "md" } }),
    Select: Select.extend({ defaultProps: { size: "md", radius: "xl" } }),
    NativeSelect: NativeSelect.extend({ defaultProps: { size: "md", radius: "xl" } }),
    NumberInput: NumberInput.extend({ defaultProps: { size: "md" } }),
    DateInput: DateInput.extend({ defaultProps: { size: "md" } }),
    Card: Card.extend({ defaultProps: { padding: "md", withBorder: true, shadow: "md" } }),
    Paper: Paper.extend({ defaultProps: { shadow: "none" } }),
    Badge: Badge.extend({ defaultProps: { variant: "filled", radius: "xl" } }),
    ThemeIcon: ThemeIcon.extend({ defaultProps: { radius: "xl" } }),
    Container: Container.extend({ defaultProps: { size: "lg" } }),
    Drawer: Drawer.extend({
      defaultProps: {
        position: "right",
        size: "md",
        padding: "lg",
        closeButtonProps: { "aria-label": "Close" },
        removeScrollProps: { removeScrollBar: false },
        scrollAreaComponent: ScrollArea.Autosize,
      },
    }),
    Modal: Modal.extend({
      defaultProps: {
        centered: false,
        padding: "lg",
        closeButtonProps: { "aria-label": "Close" },
        removeScrollProps: { removeScrollBar: false },
        scrollAreaComponent: ScrollArea.Autosize,
      },
    }),
    Skeleton: Skeleton.extend({ defaultProps: { animate: false } }),
  },
});

// Use existing Mantine semantic variables and palettes for the cinema surfaces.
export const cssVariablesResolver: import("@mantine/core").CSSVariablesResolver = (theme) => ({
  variables: {},
  light: {
    "--mantine-color-dimmed": theme.colors.gray[7],
    "--mantine-color-placeholder": theme.colors.gray[7],
  },
  dark: {
    "--mantine-color-body": theme.colors.dark[9],
    "--mantine-color-text": theme.colors.gray[1],
    "--mantine-color-dimmed": theme.colors.gray[5],
    "--mantine-color-placeholder": theme.colors.gray[5],
    "--mantine-color-anchor": theme.colors.yellow[4],
    "--mantine-color-default": theme.colors.dark[6],
    "--mantine-color-default-hover": theme.colors.dark[5],
    "--mantine-color-default-color": theme.colors.gray[1],
    "--mantine-color-default-border": theme.colors.dark[4],
  },
});
