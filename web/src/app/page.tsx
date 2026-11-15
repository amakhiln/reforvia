import { Suspense } from "react";
import { PageLoading } from "@/components/PageLoading";
import { TodayClient } from "./TodayClient";

// Today's date is only known at request time, so the client view streams in behind Suspense.
export default function Page() {
  return (
    <Suspense fallback={<PageLoading title="Today" />}>
      <TodayClient />
    </Suspense>
  );
}
