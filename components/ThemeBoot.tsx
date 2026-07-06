"use client";

import { useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { applyThemeToDocument, getAppThemePreferences } from "@/lib/user-prefs";

export default function ThemeBoot() {
  useEffect(() => {
    async function loadTheme() {
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user?.id;

      if (!userId) {
        return;
      }

      applyThemeToDocument(getAppThemePreferences(userId));
    }

    loadTheme();
  }, []);

  return null;
}
