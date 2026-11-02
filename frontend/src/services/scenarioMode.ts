/** A local lab uses production components, but never production API credentials. */
export function isScenarioMode() {
  return import.meta.env.DEV && (window.location.pathname === "/scenarios" || window.location.pathname.startsWith("/scenarios/"));
}

export function workspacePath(path: string) {
  return isScenarioMode() ? `/scenarios${path}` : path;
}
