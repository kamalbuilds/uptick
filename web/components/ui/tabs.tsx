"use client";

import * as React from "react";
import * as T from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

export const Tabs = T.Root;

/** Plain text tabs with a 2px underline on the active one, the way Robinhood's range tabs read. */
export const TabsList = ({ className, ...p }: React.ComponentProps<typeof T.List>) => (
  <T.List className={cn("flex gap-5", className)} {...p} />
);

export const TabsTrigger = ({ className, ...p }: React.ComponentProps<typeof T.Trigger>) => (
  <T.Trigger
    className={cn(
      "-mb-px h-10 max-lg:h-11 border-b-2 border-transparent text-[15px] font-medium text-mute transition-colors duration-150 hover:text-fg data-[state=active]:border-fg data-[state=active]:text-fg",
      className,
    )}
    {...p}
  />
);

export const TabsContent = T.Content;
