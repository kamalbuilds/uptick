import { Config } from "@remotion/cli/config";

import { webpackOverride } from "./webpack-override";

Config.setVideoImageFormat("png");
Config.overrideWebpackConfig(webpackOverride);
