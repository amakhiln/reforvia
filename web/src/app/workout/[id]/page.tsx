import { Suspense } from "react";
import { PageLoading } from "@/components/PageLoading";
import { WorkoutClient } from "./WorkoutClient";

export default function Page() {
  return (
    <Suspense fallback={<PageLoading title="Workout" backHref="/" hideNav />}>
      <WorkoutClient />
    </Suspense>
  );
}
