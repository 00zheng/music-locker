"use client";

import { useEffect } from "react";

export default function RegisterServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      console.log("Service workers are not supported in this browser.");
      return;
    }

    async function registerServiceWorker() {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
        });

        console.log("Service worker registered:", registration.scope);
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