// Minimal history router. Routes are path patterns with :params; links use the `link` action (or
// navigate()) so navigation stays client-side. The backend serves index.html for unknown paths.

export type RouteName =
  | "home"
  | "login"
  | "register"
  | "set-password"
  | "house"
  | "house-agents"
  | "house-members"
  | "house-log"
  | "device"
  | "shared"
  | "activity"
  | "account"
  | "admin-users"
  | "admin-server";

const ROUTES: [RouteName, RegExp][] = [
  ["home", /^\/$/],
  ["login", /^\/login$/],
  ["register", /^\/register$/],
  ["set-password", /^\/set-password$/],
  ["house", /^\/houses\/(?<id>[^/]+)$/],
  ["house-agents", /^\/houses\/(?<id>[^/]+)\/agents$/],
  ["house-members", /^\/houses\/(?<id>[^/]+)\/members$/],
  ["house-log", /^\/houses\/(?<id>[^/]+)\/log$/],
  ["device", /^\/devices\/(?<id>[^/]+)$/],
  ["shared", /^\/shared$/],
  ["activity", /^\/activity$/],
  ["account", /^\/account$/],
  ["admin-users", /^\/admin$/],
  ["admin-server", /^\/admin\/server$/],
];

export interface Route {
  name: RouteName;
  params: Record<string, string>;
  query: URLSearchParams;
}

function parse(): Route {
  const path = location.pathname.replace(/\/+$/, "") || "/";
  for (const [name, re] of ROUTES) {
    const m = re.exec(path);
    if (m) return { name, params: { ...(m.groups ?? {}) }, query: new URLSearchParams(location.search) };
  }
  return { name: "home", params: {}, query: new URLSearchParams(location.search) };
}

export const router = $state<{ route: Route }>({ route: parse() });

addEventListener("popstate", () => (router.route = parse()));

export function navigate(path: string, { replace = false } = {}): void {
  if (path === location.pathname + location.search) return;
  history[replace ? "replaceState" : "pushState"](null, "", path);
  router.route = parse();
  scrollTo({ top: 0 });
}

/** Removes query parameters (e.g. ?error= from a login redirect) once they have been read. */
export function clearQuery(): void {
  history.replaceState(null, "", location.pathname + location.hash);
  router.route = parse();
}

/** `<a href="/x" use:link>`: client-side navigation, keeping ctrl/middle click working. */
export function link(node: HTMLAnchorElement) {
  const onClick = (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const href = node.getAttribute("href");
    if (!href || !href.startsWith("/") || href.startsWith("/api/")) return;
    e.preventDefault();
    navigate(href);
  };
  node.addEventListener("click", onClick);
  return { destroy: () => node.removeEventListener("click", onClick) };
}
