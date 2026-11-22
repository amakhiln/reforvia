import { Suspense } from "react";
import { PageLoading } from "@/components/PageLoading";
import { ProfileClient } from "./ProfileClient";

export default function Page() {
  return (
    <Suspense fallback={<PageLoading title="Nutrition profile" backHref="/nutrition" />}>
      <ProfileClient />
    </Suspense>
  );
}
