import { Suspense } from "react";
import { PageLoading } from "@/components/PageLoading";
import { ExerciseClient } from "./ExerciseClient";

export default function Page() {
  return (
    <Suspense fallback={<PageLoading title="Exercise" backHref="/progress" />}>
      <ExerciseClient />
    </Suspense>
  );
}
