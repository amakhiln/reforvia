import { Suspense } from "react";
import { ExerciseClient } from "./ExerciseClient";

export default function Page() {
  return (
    <Suspense>
      <ExerciseClient />
    </Suspense>
  );
}
