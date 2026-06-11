import type { KatexOptions } from "katex";

export const KATEX_MACROS = {
  "\\differentialD": "\\mathrm{d}",
} satisfies NonNullable<KatexOptions["macros"]>;

export const KATEX_RENDER_OPTIONS = {
  throwOnError: false,
  strict: "ignore",
  macros: KATEX_MACROS,
} satisfies KatexOptions;

