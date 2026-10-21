import { createContext, useContext, useMemo } from "react";
import { fieldText, type Entity } from "../../shared/contracts";
import { useEntities } from "../state";

// Shared, memoized indexes over the entity collections. Cards and rows used to open their own
// live queries and rebuild lookup maps from every title on every render; that cost grew with
// each screen visited. Collections remain the only store; these are derived views of them.
export type Tagged = { seen: boolean; sentiment: string };
const noStatuses = new Map<string, Tagged>();
const noTitles = new Map<string, Entity>();
const noItems = new Map<string, Entity[]>();
const Statuses = createContext(noStatuses);
const Titles = createContext(noTitles);
const ListItems = createContext(noItems);
const Users = createContext(noTitles);
type SaveList = { list: Entity; titleIds: Set<string>; count: number };
const SaveLists = createContext<SaveList[]>([]);

export function compareOrder(a: Entity, b: Entity) {
  const x = fieldText(a.data.orderKey),
    y = fieldText(b.data.orderKey);
  return x < y ? -1 : x > y ? 1 : a.id.localeCompare(b.id);
}
export function ViewerProvider({
  userId,
  children,
}: {
  userId: string;
  children: React.ReactNode;
}) {
  const statuses = useEntities("status"),
    movies = useEntities("movie"),
    series = useEntities("tv"),
    items = useEntities("item"),
    users = useEntities("user"),
    lists = useEntities("list"),
    members = useEntities("collaborator");
  const tagged = useMemo(
    () =>
      new Map(
        statuses
          .filter((s) => s.data.userId === userId)
          .map((s) => [String(s.data.titleId), s.data as unknown as Tagged]),
      ),
    [statuses, userId],
  );
  const titles = useMemo(
    () => new Map([...movies, ...series].map((e) => [e.id, e])),
    [movies, series],
  );
  const itemsByList = useMemo(() => {
    const map = new Map<string, Entity[]>();
    for (const item of items) {
      const listId = fieldText(item.data.listId);
      const group = map.get(listId);
      if (group) group.push(item);
      else map.set(listId, [item]);
    }
    for (const list of map.values()) list.sort(compareOrder);
    return map;
  }, [items]);
  // Build the picker before a click, using the canonical collections. Opening a drawer must
  // not start whole-collection live queries or rescan every item for every list.
  const saveLists = useMemo(() => {
    const editable = new Set(
      members.filter((member) => member.data.userId === userId).map((member) => member.data.listId),
    );
    return lists
      .filter((list) => editable.has(list.id))
      .map((list) => {
        const entries = itemsByList.get(list.id) ?? [];
        return {
          list,
          titleIds: new Set(entries.map((item) => fieldText(item.data.titleId))),
          count: entries.length,
        };
      });
  }, [lists, members, itemsByList, userId]);
  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  return (
    <Statuses value={tagged}>
      <Titles value={titles}>
        <ListItems value={itemsByList}>
          <Users value={usersById}>
            <SaveLists value={saveLists}>{children}</SaveLists>
          </Users>
        </ListItems>
      </Titles>
    </Statuses>
  );
}
const none: Entity[] = [];
export const useViewerStatuses = () => useContext(Statuses);
export const useViewerStatus = (titleId: string): Tagged | undefined =>
  useContext(Statuses).get(titleId);
export const useTitles = () => useContext(Titles);
export const useListItems = (listId: string) => useContext(ListItems).get(listId) ?? none;
export const useUsers = () => useContext(Users);
export const useSaveLists = () => useContext(SaveLists);
