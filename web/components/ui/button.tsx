import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const button = cva(
  "press inline-flex items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap select-none disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        primary: "bg-fg text-canvas hover:bg-fg/88",
        outline: "border border-line bg-transparent text-fg hover:bg-panel",
        soft: "bg-raised text-fg hover:bg-line/60",
      },
      size: { md: "h-11 px-6 text-[15px]", lg: "h-12 px-8 text-[15px]", sm: "touch h-9 px-4 text-[13px]" },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof button> & { asChild?: boolean };

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild, ...p }, ref) => {
  const Comp = asChild ? Slot : "button";
  return <Comp ref={ref} className={cn(button({ variant, size }), className)} {...p} />;
});
Button.displayName = "Button";
