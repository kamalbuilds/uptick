"use client";

import * as React from "react";
import * as T from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

export const Tabs = T.Root;

export const TabsList = ({ className, ...p }: React.ComponentProps<typeof T.List>) => (
  <T.List className={cn("grid grid-cols-2 gap-1 rounded-full bg-sage p-1", className)} {...p} />
);

export const TabsTrigger = ({ className, ...p }: React.ComponentProps<typeof T.Trigger>) => (
  <T.Trigger
    className={cn(
      "h-10 rounded-full text-sm font-semibold transition-[background-color,color] duration-150 data-[state=active]:bg-canvas data-[state=active]:text-ink text-body hover:text-ink",
      className,
    )}
    {...p}
  />
);

export const TabsContent = T.Content;
