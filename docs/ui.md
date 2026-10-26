# UI conventions

Read this before changing browser UI. React and Mantine 9.7.3 are the only UI
framework and design system. Use the [official component documentation](https://mantine.dev/)
and the installed package types before implementing an unfamiliar interaction.

## Screen inventory and migration boundaries

| Area                   | Routes / interactions                                                                                  | Mantine composition                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Shell and route states | Every authenticated route, restoration, previews, errors, 404                                          | AppShell, Container, NavLink, Burger, Skeleton, Alert                    |
| Sign-in                | `/auth`, availability, errors, return destination                                                      | Paper, Stack, Google branded action                                      |
| Discovery              | `/`, virtual feed, genre/type/sort filters, advanced numeric/date/provider filters, saved feeds        | Card, SegmentedControl, NativeSelect, Checkbox, Drawer, Accordion, Modal |
| Search                 | `/search?q=…`, titles, people, members, public lists                                                   | TextInput, SimpleGrid, NavLink                                           |
| Catalog detail         | `/title/$id`: movie, TV, person, season, episode; credits, metadata, providers, relations              | Grid, Stack, Badge, Tabs, semantic definition list                       |
| Lists                  | `/lists`, owned/saved/explore tabs, create/edit                                                        | Tabs, Card, SimpleGrid, Drawer                                           |
| List detail            | `/lists/$listId`, search, add/remove, item moves/drag, copies, follows, members/invitations            | Grid, Paper, ActionIcon, TextInput, Drawer, NavLink                      |
| Activity               | `/activity`, updates, accept/decline invitations                                                       | Stack, Avatar, Anchor, Button                                            |
| Profiles               | `/profile`, `/profile/$userId`, sentiment/seen/lists/feeds tabs, edits, follows, sign-out, attribution | Avatar, Tabs, SimpleGrid, Drawer                                         |
| Shared feedback        | Title tags, add-to-list picker and inline creation, notices                                            | Button, Drawer, NavLink, Notifications                                   |

There are no separate settings or admin screens in this repository. The migration
boundary is the browser presentation layer: TanStack Router routes, canonical DB
collections, optimistic command IDs, API/domain behavior and backend permissions
remain authoritative. Tailwind, Radix wrappers, CVA, clsx and tailwind-merge were
removed along with the old global stylesheet.

## Start here

- `src/client/theme.ts` is the only theme. Its playful cinema presentation uses
  Mantine's built-in dark/gray surfaces, yellow primary actions and violet, pink
  and cyan accents. Surfaces use the standard `lg` radius, controls use `xl`
  pill radii, and spacing, shadows and breakpoints remain Mantine tokens.
  The app uses a dark color scheme and system sans-serif typography with bold
  headings. There are no downloaded fonts or font swaps. Existing semantic
  variables define readable gray text and warm links centrally.
  Do not add feature themes, custom palettes or token systems.
- `src/client/providers.tsx` is the only provider configuration. `main.tsx` imports
  Mantine package CSS once. Every rendered entry point must use `Providers`.
- `components/navigation.tsx` owns `AppShell`, desktop navigation, the mobile
  navigation toggle and mobile footer. Route paths and authentication are unchanged.
  The brand mark is 🍿, decorative beside MovieFinder. `public/icon.svg` uses
  the same emoji for the favicon.
- `AppShell.Main` contains one `Container`. A route starts with `Stack gap="lg"`
  and `PageHeading` (one h1 and optional actions). Use plain app labels: Discover,
  Search, Lists, Activity, Profile. No slogans, editorial eyebrows or promotional copy.
- Artwork is the visual focus. Title cards frame reserved poster and metadata
  slots in Mantine Card; dark Paper surfaces and divided section headings group
  secondary content. Bright static film strips, popcorn and cinema stickers,
  dashed ticket separators and colourful reaction pills give the UI personality.
  Movie accents are warm yellow/pink; person accents are cyan/violet. These are
  built-in Mantine colours, not feature themes. Decoration is noninteractive,
  aria-hidden, and mounted in the shared geometry before data arrives.
  Keep decoration in Mantine compositions and supported props, without custom CSS.

## Compose first

1. Check whether Mantine has the component or behavior.
2. Configure its supported props or compose existing Mantine components.
3. Reuse a product composition only when it fits. Do not wrap individual primitives.
4. Introduce a new abstraction only for recurring product behavior or a semantic contract.

Use `Stack` vertically, `Group` horizontally, `Flex` for direction changes, and
`Grid`/`SimpleGrid` for responsive columns. Standard title grids use 2 / 3 / 4 / 5
columns at base / xs / md / lg. List grids use 1 / 2 / 3 at base / xs / lg.
Use theme spacing (`xs`, `sm`, `md`, `lg`, `xl`), component sizes and default radii.
Keep numeric dimensions for structural geometry, artwork aspect ratios and icons only.
Box geometry props such as `h`, `w`, `top` and `left` take CSS lengths: reference
`var(--mantine-spacing-sm)` rather than passing a bare spacing key. Component
`size`, `radius`, padding, margin and gap props resolve their supported theme keys.
Use `renderRoot` with a typed TanStack `Link` for Mantine links and linked cards.
The bounded discovery feed stacks artwork and controls below md so tablet content
is not compressed beside the sidebar. Its title actions use the compact Mantine
size; other actions inherit the shared defaults.

- Primary action: default `Button`. Secondary: `variant="default"`. Tertiary:
  `variant="subtle"`. Destructive: `color="red"`. Icon actions: `ActionIcon` with
  an accessible name. Toggle actions: `aria-pressed` and a distinct selected state.
  Title reactions use coloured `light` pills, becoming `filled` when selected;
  other toggles keep their established selected variants.
- Inputs: labeled Mantine controls. Simple forms use native `FormData`, browser
  constraints and existing Zod contracts. Mantine `NumberInput` and `DateInput`
  handle numeric and calendar controls. Show errors with `Alert`/input `error` or
  the shared notification bridge; retain form values after failures. Disable
  submission during commands. No spinning indicators (product requirement).
- Editing and selection: `Drawer`. Short named input: `Modal`. Preserve Mantine's
  Escape, focus trap, accessible title, close button and return focus behavior.
  No `window.prompt`, `alert` or `confirm`.
- Tabs: `Tabs.List`, `Tabs.Tab`, **and `Tabs.Panel`**. Type selection uses
  `SegmentedControl`. Use built-in keyboard and selected states.
- Loading: nonanimated `Skeleton` or concise status text. Empty: shared `Empty`.
  Errors: `Alert` and a retry where possible. Mutation feedback: existing `notify`
  / `report` bridge to Mantine notifications. Preserve optimistic operations.
- Artwork: shared `Image` and `Poster` preserve source selection, fallbacks,
  responsive sources, lazy loading and telemetry. Do not build TMDB URLs in views.

## Accessibility and responsive behavior

Keep one h1, then h2 sections and h3 items. Label every form control and icon
action. Preserve visible focus, native keyboard behavior, meaningful image text
and Mantine reduced-motion support. Use theme responsive props, not media queries.
Wrap actions on narrow screens and use scroll areas for intentionally bounded
content. Tables, if added, need Mantine `Table.ScrollContainer` or an equivalent
narrow-screen strategy. Do not use a disabled control without explaining its state.

## Layout stability

Treat loading, empty, error and complete data as states of the same fixed geometry.
Do not insert async feedback above content or allow fetched text to resize controls.

- Native page scrollbar space is permanent. Mantine scroll areas use `type="always"`,
  `scrollbars="y"` and `offsetScrollbars="y"` centrally. Never use `auto`, `hover`,
  `scroll` or dynamic `offsetScrollbars="present"` for application scroll areas.
- Modal/Drawer use the same persistent scroll area. Their supported
  `removeScrollProps.removeScrollBar=false` retains the page gutter while keeping
  Mantine's wheel/touch isolation, focus trap and Escape handling. AppShell does
  not add a second scrollbar-width compensation. Modals are top anchored.
- Notifications use Mantine's stacked layout, top anchored below the AppShell
  header, with no height/entry transitions. Keep Mantine's queue, close, focus,
  hover and touch behavior; do not build a separate toast layout or queue.
- Use `DataSection` for asynchronous collections. Its heading and scroll viewport
  reserve space before data arrives. Search buckets and detail sections stay
  mounted; missing results have an explicit empty state inside the same frame.
  Keep scrolling regions keyboard accessible and label them through the composition.
- Discovery's empty/error state occupies the same 40rem as the feed. Coverage
  notices follow the feed and cannot displace it. Toolbar and counter widths are fixed.
- `DetailHero` is shared by previews and hydrated detail views. Poster, two-line
  title, facts, genres, synopsis, actions and links keep the same slots. Detail
  section geometry is determined by the canonical route kind, not optional data.
  Facts and genre links use independent grid slots. Votes, original title and
  tagline live in the fixed metadata grid; late copy cannot push the synopsis.
  Metadata rows retain their slots with explicit unavailable values. Poster
  fallbacks say "No image"; the neighboring heading supplies the title.
  `DetailStatus` shares one compact feedback/retry slot between preview and full
  views. Error actions must fit inside this slot on small screens.
- `DataSection` keeps the same bordered surface and mounted scroll viewport for
  skeletons, data and empty states. Person detail previews also reserve filmography
  tabs and biography geometry before the person record arrives. Person facts show
  department and available life dates/place in fixed cells, with a 14rem biography
  viewport; title pages keep separate facts/genre slots and a 10rem synopsis.
- Profiles share `ProfileHeader` between route preview and full view. Biography,
  name, statistics, actions and tab content have reserved geometry. Navigation
  labels truncate instead of resizing the shell when an account name arrives.
- Search assigns UI slots by canonical entity ID. Late provider batches append
  without moving existing cards; **Refresh order** applies current provider ranking.
  Activity follows the same rule; **Show latest** applies the latest time ordering.
  These actions are enabled only when incoming data changes the ordering.
  `ActivityCaption` gives actor names and actions separate fixed lines in activity
  and list history; late or edited names cannot displace the action or timestamp.
  `useStableOrder` retains IDs only, never copies of server entities.
- Title/list cards reserve artwork, two title lines, metadata and badge space.
  Each status badge has its own slot, so Seen and sentiment can arrive independently.
  Catalog card badges use full-width stacked slots so ratings stay readable in
  narrow multi-column grids.
  Changing counters use fixed, left-aligned monospace slots; never center a
  changing number inside a label whose intrinsic width can resize.
  List pickers, title pickers, list entries and collaboration panels own bounded
  scroll frames so late rows cannot push another control out from under the pointer.
  List Save/Copy actions precede permission-dependent actions. Do not insert late
  owner/editor actions ahead of existing controls. Changing fixed-width action
  labels are left aligned so their icons and text stay anchored.
- Read existing canonical collection rows while live-query subscriptions attach;
  never flash a known list empty or copy server entities into component caches.
- Preserve image aspect ratios on success, failure and missing artwork. Use system
  fonts and stable text slots; do not introduce font swaps or animated dimensions.

Run `bun run test:e2e layout-stability.spec.ts` for delayed hydration, live metadata,
artwork and badges, native classic scrollbars, modal/drawer changes and exact
geometry checks, independent status updates, late permissions, incoming activity,
actor-name changes, retry failures and notification appearance/disappearance.
These tests reject every layout-shift event, including tiny shifts
and shifts occurring just after user input; do not round them or add a tolerance.

## Styling policy and exceptions

Default custom CSS is zero. Do not add styling dependencies, utility classes,
CSS modules, inline `style`, `styles`, `classNames`, or selectors for Mantine internals.
Use Mantine props and defaults. New CSS requires a concrete Mantine limitation
recorded here and a narrow exception in the architecture check.

`src/client/interactions.css` contains only four functional exceptions:

- The browser viewport has no Mantine component. Its root always uses
  `overflow-y: scroll` and `scrollbar-gutter: stable`; do not change either.

- Mantine 9.7.3's scrollbar thumb centers a minimum-size hit-area pseudo-element.
  Chromium attributed raw shifts below 0.000001 to it while reporting identical
  previous/current rectangles during progressive search. The supported
  [ScrollArea Styles API](https://mantine.dev/core/scroll-area/) assigns one theme
  class that anchors the existing hit area at its host origin instead of centering
  it with percentage offsets. This version-specific exception preserves its
  minimum size, pseudo-element, thumb
  sizing, dragging and viewport touch/keyboard scrolling. Do not target generated
  Mantine classes, remove its hit area, or suppress telemetry entries.
  Reverify this exception when upgrading Mantine.

- Pointer-based list reordering requires `touch-action: none` on its handle.
  The rest of the row remains scrollable; accessible arrow actions remain available.
- Mantine `VisuallyHidden` has no reveal-on-focus API. The skip link is clipped
  until focus and layered above the fixed shell. Focus styles come from Mantine.

Swiper is retained for virtual vertical gesture navigation, which Mantine does
not provide. Its viewport uses a Mantine `Box` size prop; all slide content and
actions use Mantine.

The official Google sign-in bitmap remains unmodified inside `UnstyledButton`.
It is a narrow provider-brand requirement, not a new application button primitive.
Lucide supplies icons only. Existing unstyled class names on cards/detail views
are stable browser/performance hooks; they carry no visual rules.

## Checks

Run `bun run check` and `bun run build` after UI changes. Run `bun run test:e2e`
for interactions, navigation, narrow layouts and accessibility; run
`bun run test:integration` when contracts or command behavior could be affected.
`tests/unit/ui-architecture.test.ts` enforces styling/dependency/provider boundaries.
Browser tests preserve existing workflows and latency requirements. Do not weaken
checks or remove functionality to clear failures.
