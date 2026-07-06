"use client";

import { useEffect } from "react";
import { supabase } from "@/lib/supabase";
import {
  applyThemeToDocument,
  getAppThemePreferences,
  loadSyncedUserPreferences,
} from "@/lib/user-prefs";

export default function ThemeBoot() {
  useEffect(() => {
    async function loadTheme() {
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user?.id;

      if (!userId) {
        return;
      }

      applyThemeToDocument(getAppThemePreferences(userId));
      const { preferences } = await loadSyncedUserPreferences(supabase, userId);
      applyThemeToDocument(preferences.theme);
    }

    void loadTheme();
  }, []);

  return null;
}
