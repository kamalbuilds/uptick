import type { Metadata } from "next";
import { TalkInterview } from "@/components/talk-form";

export const metadata: Metadata = {
  title: "Talk to Uptick",
  description: "Five questions about what your Stock Tokens do today. Three minutes, no wallet, no sign-in.",
};

export default function TalkPage() {
  return <TalkInterview />;
}
