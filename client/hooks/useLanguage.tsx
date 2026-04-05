/**
 * Language Context — inspired by Claude Code's centralized AppState pattern.
 *
 * Replaces prop drilling of `language` through 6+ page components.
 * Single source of truth for the active language, accessible via useLanguage().
 */

import { createContext, useContext } from "react";
import type { Language } from "../App";

const LanguageContext = createContext<Language>("zh-TW");

export const LanguageProvider = LanguageContext.Provider;

export function useLanguage(): Language {
  return useContext(LanguageContext);
}
