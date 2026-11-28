import test from "node:test";
import assert from "node:assert/strict";
import { demoLinks } from "./demoVideo.ts";

const links = (name: string, video_url: string | null = null) => demoLinks({ name, video_url });

test("the first link searches the DEMIC channel for the exercise", () => {
  assert.equal(links("Lat pulldown").channel, "https://www.youtube.com/@officialdemic/search?query=Lat%20pulldown");
});

test("notes that would narrow the search are left out of it", () => {
  const query = (name: string) => decodeURIComponent(links(name).channel!.split("query=")[1]);
  assert.equal(query("Leg press (or squat)"), "Leg press");
  assert.equal(query("Seated cable row (neutral grip)"), "Seated cable row");
  assert.equal(query("Cable or machine lateral raise"), "Cable lateral raise");
  assert.equal(query("Chin-up & hold"), "Chin-up & hold");
});

test("general cardio has no channel link, as the channel has nothing for it", () => {
  assert.equal(links("Moderate cardio").channel, null);
});

test("a YouTube search is always there, using the plan's own link when it has one", () => {
  assert.equal(links("Hammer curl", "https://www.youtube.com/results?search_query=x").search, "https://www.youtube.com/results?search_query=x");
  assert.equal(links("Chin-up & hold").search, "https://www.youtube.com/results?search_query=Chin-up%20%26%20hold%20proper%20form");
});
