export function formatTs(epochSecs: number): string {
  return new Date(epochSecs * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

export function statusBadgeClass(status: string): string {
  const map: Record<string, string> = {
    success: "badge-success",
    pending: "badge-pending",
    in_flight: "badge-inflight",
    exhausted: "badge-exhausted",
    failed: "badge-failed",
  };
  return map[status] ?? "badge-unknown";
}

export function truncate(str: string | null | undefined, len = 120): string {
  if (!str) return "";
  return str.length <= len ? str : str.slice(0, len) + "…";
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}
