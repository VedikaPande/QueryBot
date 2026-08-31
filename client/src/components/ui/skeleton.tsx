import type * as React from "react"

import { cn } from "@/lib/utils"

/** Placeholder block shown while content loads. */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("skeleton rounded-md", className)}
      aria-hidden
      {...props}
    />
  )
}

export { Skeleton }
