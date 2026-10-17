import { Config } from "@remotion/cli/config";

// PNG frames keep the off-white canvas and ink as limited-range yuv420p (JPEG frames tag yuvj420p and lift blacks).
Config.setVideoImageFormat("png");
Config.setOverwriteOutput(true);
Config.setPixelFormat("yuv420p");
Config.setCodec("h264");
