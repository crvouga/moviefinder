import { Link } from "@tanstack/react-router";
import {
  Film,
  Compass,
  Search,
  Bookmark,
  Users,
  UserRound,
  ArrowUpRight,
  Sparkles,
} from "lucide-react";
import { useEntities } from "../state";
export default function Navigation({ userId }: { userId: string }) {
  const users = useEntities("user"),
    invitations = useEntities("invitation"),
    user = users.find((u) => u.id === userId),
    nav = [
      { to: "/", icon: Compass, label: "Discover" },
      { to: "/search", icon: Search, label: "Search" },
      { to: "/lists", icon: Bookmark, label: "Collections" },
      { to: "/activity", icon: Users, label: "Community" },
      { to: "/profile", icon: UserRound, label: "Your profile" },
    ] as const;
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="sidebar">
        <Link to="/" className="brand">
          <span className="brand-icon">
            <Film size={18} />
          </span>
          moviefinder<span className="brand-dot">.</span>
        </Link>
        <span className="sidebar-label">THE GOOD STUFF</span>
        <nav aria-label="Main navigation">
          {nav.map(({ to, icon: Icon, label }) => (
            <Link
              key={to}
              to={to}
              className="nav-link"
              activeProps={{ className: "active" }}
              activeOptions={{ exact: to !== "/lists", includeSearch: false }}
            >
              <Icon size={19} />
              <span>{label}</span>
              {to === "/activity" &&
                invitations.some((i) => i.data.userId === userId && i.data.state === "pending") && (
                  <i className="notification-dot" />
                )}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <Sparkles size={17} />
            <p>
              Life’s too short
              <br />
              for a bad movie night.
            </p>
            <span>Find a story worth staying in for.</span>
          </div>
          <Link to="/profile" className="sidebar-profile">
            <span className="avatar">{user?.title[0] ?? "M"}</span>
            <span>
              <strong>{user?.title ?? "Movie lover"}</strong>
              <small>A little good taste.</small>
            </span>
            <ArrowUpRight size={16} />
          </Link>
        </div>
      </aside>
      <header className="mobile-header">
        <Link to="/" className="brand">
          <Film size={18} />
          moviefinder<span className="brand-dot">.</span>
        </Link>
        <Link to="/profile" className="avatar" aria-label="Your profile">
          {user?.title[0] ?? "M"}
        </Link>
      </header>
      <nav className="bottom-nav" aria-label="Mobile navigation">
        {nav.map(({ to, icon: Icon, label }) => (
          <Link
            key={to}
            to={to}
            aria-label={label}
            activeProps={{ className: "active" }}
            activeOptions={{ exact: to !== "/lists", includeSearch: false }}
          >
            <Icon size={21} />
            <span>
              {label === "Your profile"
                ? "Profile"
                : label === "Collections"
                  ? "Lists"
                  : label === "Community"
                    ? "Activity"
                    : label}
            </span>
          </Link>
        ))}
      </nav>
    </>
  );
}
