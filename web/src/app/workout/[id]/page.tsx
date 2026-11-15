import { Suspense } from "react";
import { WorkoutClient } from "./WorkoutClient";

export default function Page() {
  return (
    <Suspense>
      <WorkoutClient />
    </Suspense>
  );
}
