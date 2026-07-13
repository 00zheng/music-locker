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

    const recoveryFlag = "music-locker-sw-recovered";

    async function clearStaleServiceWorkerState() {
      const registrations = await navigator.serviceWorker.getRegistrations();
      const cacheNames = "caches" in window ? await caches.keys() : [];

      await Promise.all(registrations.map((registration) => registration.unregister()));

      await Promise.all(
        cacheNames
          .filter((cacheName) => cacheName.startsWith("music-locker-"))
          .map((cacheName) => caches.delete(cacheName))
      );

      return registrations.length > 0 || cacheNames.some((cacheName) => cacheName.startsWith("music-locker-"));
    }

    async function registerServiceWorker() {
      try {
        const hasRecovered = window.sessionStorage.getItem(recoveryFlag) === "1";

        if (!hasRecovered) {
          const clearedState = await clearStaleServiceWorkerState();

          if (clearedState) {
            window.sessionStorage.setItem(recoveryFlag, "1");
            window.location.reload();
            return;
          }
        }

        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
        });

        void registration.update();
      } catch (error) {
        console.error("Service worker registration failed:", error);
      }
    }

    if (document.readyState === "complete") {
      registerServiceWorker();
    } else {
      window.addEventListener("load", registerServiceWorker);
    }

    return () => {
      window.removeEventListener("load", registerServiceWorker);
    };
  }, []);

  return null;
}
