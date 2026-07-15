"use client";

import dynamic from "next/dynamic";

const PlayerBridge = dynamic(() => import("@/components/PlayerBridge"), {
  ssr: false,
});

export default function DeferredPlayerBridge() {
  return <PlayerBridge />;
}
