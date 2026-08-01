"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthFlow, PasswordAuthShell } from "../../components/auth/auth-flow";
import { configApi, isPasswordAuthMode } from "../../lib/config-api/client";

export function RegisterClient() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!isPasswordAuthMode()) {
      router.replace("/energyiq/overview");
      return;
    }
    let cancelled = false;
    configApi
      .getMe()
      .then(() => {
        if (!cancelled) router.replace("/energyiq/overview");
      })
      .catch(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (checking) {
    return <PasswordAuthShell title="Loading account..." />;
  }

  return <AuthFlow initialMode="register" onAuthenticated={() => router.replace("/energyiq/overview")} />;
}
