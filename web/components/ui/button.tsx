import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const button = cva(
  "inline-flex items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap select-none transition-[transform,background-color,color,border-color] duration-150 ease-out active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45",
  {
    variants: {
      variant: {
        primary: "bg-primary text-ink hover:bg-primary-active",
        dark: "bg-ink text-primary hover:bg-ink-deep",
        soft: "bg-sage text-ink hover:bg-sage-line",
        outline: "border border-ink bg-canvas text-ink hover:bg-primary-pale",
      },
      size: { md: "h-11 px-6 text-base", lg: "h-14 px-8 text-lg", sm: "h-9 px-4 text-sm" },
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
