"use client";

import { useEffect } from "react";

export default function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      return;
    }

    if (!("serviceWorker" in navigator)) {
      return;
    }

    async function registerServiceWorker() {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
        });

        void registration.update();
      } catch (error) {
        console.error("Service worker registration failed:", error);
      }
    }

    let idleCallbackId: number | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    function scheduleRegistration() {
      if (typeof window.requestIdleCallback === "function") {
        idleCallbackId = window.requestIdleCallback(() => void registerServiceWorker(), { timeout: 2500 });
        return;
      }

      timeoutId = globalThis.setTimeout(() => void registerServiceWorker(), 1);
    }

    if (document.readyState === "complete") {
      scheduleRegistration();
    } else {
      window.addEventListener("load", scheduleRegistration);
    }

    return () => {
      window.removeEventListener("load", scheduleRegistration);

      if (idleCallbackId !== null && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleCallbackId);
      }

      if (timeoutId !== null) {
        globalThis.clearTimeout(timeoutId);
      }
    };
  }, []);

  return null;
}
