import path from "node:path";

import { enableTailwind } from "@remotion/tailwind-v4";
import type { WebpackOverrideFn } from "@remotion/bundler";

/**
 * One override for remotion.config.ts and scripts/stills.ts.
 * - Tailwind v4 through Remotion's own bundled copy (never declared here).
 * - "@" is the web app root, so the film imports the app's real components and lib.
 * - react and react-dom resolve to this package only, so the app's files and the film share one React.
 * process.cwd() is web/videos (the CLI loads this file as CommonJS).
 */
export const webpackOverride: WebpackOverrideFn = (config) => {
  const tailwind = enableTailwind(config);
  const here = process.cwd();
  return {
    ...tailwind,
    resolve: {
      ...tailwind.resolve,
      alias: {
        ...(tailwind.resolve?.alias as Record<string, string> | undefined),
        "@": path.resolve(here, ".."),
        react: path.resolve(here, "node_modules/react"),
        "react-dom": path.resolve(here, "node_modules/react-dom"),
      },
    },
  };
};
