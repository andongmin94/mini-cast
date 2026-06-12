import * as SwitchPrimitive from "@radix-ui/react-switch";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export function Switch({
  className,
  ...props
}: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "bg-input data-[state=checked]:bg-primary inline-flex h-5 w-8 items-center rounded-full",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="bg-background block size-4 rounded-full transition-transform data-[state=checked]:translate-x-4" />
    </SwitchPrimitive.Root>
  );
}
