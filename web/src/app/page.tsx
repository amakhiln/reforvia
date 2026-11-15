import { Suspense } from "react";
import { TodayClient } from "./TodayClient";

// Today's date is only known at request time, so the client view streams in behind Suspense.
export default function Page() {
  return (
    <Suspense>
      <TodayClient />
    </Suspense>
  );
}
