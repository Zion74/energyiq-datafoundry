"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthFlow, PasswordAuthShell, type AuthMode } from "../../components/auth/auth-flow";
import { configApi, isPasswordAuthMode } from "../../lib/config-api/client";

export function LoginClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [checking, setChecking] = useState(true);
  const returnTo = useMemo(() => safeEnergyIqReturnTo(searchParams.get("returnTo")), [searchParams]);
  const authEntry = useMemo<{ mode: AuthMode; token: string }>(() => {
    const invite = searchParams.get("invite");
    if (invite) return { mode: "invite", token: invite };
    const reset = searchParams.get("reset");
    if (reset) return { mode: "reset", token: reset };
    const verify = searchParams.get("verify");
    if (verify) return { mode: "verify", token: verify };
    return { mode: "login", token: "" };
  }, [searchParams]);

  const redirectAfterAuthentication = useCallback(async () => {
    if (returnTo) {
      router.replace(returnTo);
      return;
    }
    try {
      const access = await configApi.getEnergyAccessContext();
      router.replace(access.role === "admin" ? "/energyiq/admin" : "/energyiq/overview");
    } catch {
      router.replace("/energyiq/overview");
    }
  }, [returnTo, router]);

  useEffect(() => {
    if (!isPasswordAuthMode()) {
      router.replace("/energyiq/overview");
      return;
    }
    let cancelled = false;
    configApi
      .getMe()
      .then(async () => {
        if (!cancelled) await redirectAfterAuthentication();
      })
      .catch(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [redirectAfterAuthentication, router]);

  if (checking) {
    return <PasswordAuthShell title="Loading account..." />;
  }

  return (
    <AuthFlow
      key={`${authEntry.mode}:${authEntry.token}`}
      initialMode={authEntry.mode}
      initialToken={authEntry.token}
      onAuthenticated={redirectAfterAuthentication}
    />
  );
}

function safeEnergyIqReturnTo(value: string | null): string | null {
  if (!value || !value.startsWith("/energyiq/") || value.startsWith("//")) return null;
  return value;
}
