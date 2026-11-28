/** Demo links for an exercise: the DEMIC YouTube channel first, then a general YouTube search. */
const CHANNEL = "https://www.youtube.com/@officialdemic";

export function demoLinks(ex: { name: string; video_url: string | null }) {
  const search = ex.video_url ?? `https://www.youtube.com/results?search_query=${encodeURIComponent(`${ex.name} proper form`)}`;
  // Searching the channel (not a list of video ids) also finds what it uploads later.
  const query = ex.name.replace(/\([^)]*\)/g, "").replace(/\bor machine\b/i, "").replace(/\s+/g, " ").trim();
  const channel = /\bcardio\b/i.test(query) ? null : `${CHANNEL}/search?query=${encodeURIComponent(query)}`;
  return { channel, search };
}
