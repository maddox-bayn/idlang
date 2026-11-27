import type { ComponentType, ReactNode, SVGProps } from "react";

export type Tab = "feed" | "library" | "learn" | "messages" | "translate";

type IconProps = SVGProps<SVGSVGElement>;

/** Lucide-style stroke icon wrapper (no external icon dependency). */
function IconBase({ children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Tab icons                                                           */
/* ------------------------------------------------------------------ */

export function HomeIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
      <path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </IconBase>
  );
}

export function BookOpenIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 7v14" />
      <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
    </IconBase>
  );
}

export function GraduationCapIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z" />
      <path d="M22 10v6" />
      <path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5" />
    </IconBase>
  );
}

export function MessageCircleIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
    </IconBase>
  );
}

export function LanguagesIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m5 8 6 6" />
      <path d="m4 14 6-6 2-3" />
      <path d="M2 5h12" />
      <path d="M7 2h1" />
      <path d="m22 22-5-10-5 10" />
      <path d="M14 18h6" />
    </IconBase>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h16" />
    </IconBase>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m15 18-6-6 6-6" />
    </IconBase>
  );
}

/* ------------------------------------------------------------------ */
/* Nav item configuration                                              */
/* ------------------------------------------------------------------ */

export interface NavItem {
  id: Tab;
  /** Full label shown in the expanded sidebar and used for a11y names. */
  label: string;
  /** Compact label for the mobile bottom bar (space constrained). */
  shortLabel: string;
  Icon: ComponentType<IconProps>;
}

export const NAV_ITEMS: NavItem[] = [
  { id: "feed", label: "Feed", shortLabel: "Feed", Icon: HomeIcon },
  { id: "library", label: "E-Library", shortLabel: "Library", Icon: BookOpenIcon },
  { id: "learn", label: "Learn & Tracks", shortLabel: "Learn", Icon: GraduationCapIcon },
  { id: "messages", label: "Messages", shortLabel: "Inbox", Icon: MessageCircleIcon },
  { id: "translate", label: "Translate", shortLabel: "Translate", Icon: LanguagesIcon },
];

/** Display label for the currently active tab (used in the header). */
export function navLabel(tab: Tab): string {
  return NAV_ITEMS.find((item) => item.id === tab)?.label ?? "";
}

/* ------------------------------------------------------------------ */
/* Sidebar layout preference (persisted)                               */
/* ------------------------------------------------------------------ */

export interface NavState {
  /** Sidebar visible (desktop). */
  open: boolean;
  /** Sidebar squeezed to an icon-only rail (desktop). */
  collapsed: boolean;
}

const STORAGE_KEY = "idlang.nav.layout";

export const DEFAULT_NAV_STATE: NavState = { open: true, collapsed: false };

export function loadNavState(): NavState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<NavState>;
      return { open: parsed.open !== false, collapsed: parsed.collapsed === true };
    }
  } catch {
    // Corrupted or unavailable storage — fall back to defaults.
  }
  return DEFAULT_NAV_STATE;
}

export function saveNavState(state: NavState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable — preference just won't persist.
  }
}

/* ------------------------------------------------------------------ */
/* Desktop: collapsible left sidebar                                   */
/* ------------------------------------------------------------------ */

interface SidebarNavProps {
  onLogout: () => void;
  activeTab: Tab;
  onSelect: (tab: Tab) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

function LogoutIcon() {
  return <svg aria-hidden="true" className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M10 4H5v16h5m4-12 4 4-4 4m-6-4h10" /></svg>;
}

export function SidebarNav({ activeTab, onSelect, collapsed, onToggleCollapse, onLogout }: SidebarNavProps) {
  return (
    <aside
      id="app-sidebar"
      className={`fixed inset-y-0 left-0 z-50 hidden border-r border-red-900/30 bg-black transition-all duration-200 lg:flex lg:flex-col ${
        collapsed ? "w-16" : "w-64"
      }`}
    >
      <div
        className={`flex h-14 shrink-0 items-center border-b border-red-900/30 ${
          collapsed ? "justify-center px-2" : "justify-between px-4"
        }`}
      >
        {!collapsed && (
          <span className="font-heading text-xs font-bold uppercase tracking-widest text-red-300">
            Main
          </span>
        )}
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={collapsed ? "Expand navigation menu" : "Collapse navigation menu"}
          title={collapsed ? "Expand navigation menu" : "Collapse navigation menu"}
          className="rounded-md p-1.5 text-red-400 transition-colors hover:bg-red-900/40 hover:text-red-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
        >
          <ChevronLeftIcon className={`h-4 w-4 transition-transform ${collapsed ? "rotate-180" : ""}`} />
        </button>
      </div>

      <nav aria-label="Community" className="flex-1 overflow-y-auto p-3">
        {!collapsed && (
          <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-widest text-red-700">
            Explore
          </p>
        )}
        <ul className="flex flex-col gap-1">
          {NAV_ITEMS.map(({ id, label, Icon }) => {
            const active = activeTab === id;
            return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => onSelect(id)}
                  aria-label={label}
                  aria-pressed={active}
                  aria-current={active ? "page" : undefined}
                  title={label}
                  className={`flex w-full items-center gap-3 rounded-lg py-2.5 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${
                    collapsed ? "justify-center px-0" : "px-3"
                  } ${
                    active
                      ? "bg-red-900 text-red-100 shadow"
                      : "text-red-500 hover:bg-red-950/60 hover:text-red-300"
                  }`}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  {!collapsed && (
                    <span className="truncate text-xs font-semibold uppercase tracking-wider">
                      {label}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="shrink-0 border-t border-red-900/40 p-3">
        <button onClick={onLogout} type="button" title="Log Out" aria-label="Log Out"
          className={`flex w-full items-center gap-3 rounded-lg py-2.5 text-sm text-neutral-300 hover:bg-red-950 focus-visible:ring-2 focus-visible:ring-red-500 ${collapsed ? "justify-center" : "px-3"}`}>
          <LogoutIcon />{!collapsed && "Log Out"}
        </button>
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* Mobile: fixed bottom icon bar                                       */
/* ------------------------------------------------------------------ */

interface MobileTabBarProps {
  onLogout: () => void;
  activeTab: Tab;
  onSelect: (tab: Tab) => void;
}

export function MobileTabBar({ activeTab, onSelect, onLogout }: MobileTabBarProps) {
  return (
    <nav
      aria-label="Community"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-red-800/60 bg-black/95 backdrop-blur lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto flex max-w-md">
        {NAV_ITEMS.map(({ id, label, shortLabel, Icon }) => {
          const active = activeTab === id;
          return (
            <li key={id} className="min-w-0 flex-1">
              <button
                type="button"
                onClick={() => onSelect(id)}
                aria-label={label}
                aria-pressed={active}
                aria-current={active ? "page" : undefined}
                title={label}
                className={`flex w-full flex-col items-center gap-0.5 px-1 py-2.5 text-[10px] font-semibold uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-500 ${
                  active ? "text-red-400" : "text-red-600 hover:text-red-300"
                }`}
              >
                <Icon className={`h-5 w-5 ${active ? "drop-shadow-[0_0_6px_rgba(220,38,38,0.8)]" : ""}`} />
                <span className="w-full truncate px-0.5 text-center leading-tight">{shortLabel}</span>
              </button>
            </li>
          );
        })}
        <li className="min-w-0 flex-1">
          <button type="button" onClick={onLogout} aria-label="Log Out" className="flex w-full flex-col items-center gap-0.5 py-2.5 text-[10px] font-semibold uppercase text-neutral-400 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-500"><LogoutIcon />Log Out</button>
        </li>
      </ul>
    </nav>
  );
}
