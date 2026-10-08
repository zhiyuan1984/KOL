import type { ButtonHTMLAttributes } from "react";

/** Emphasis and size are independent; dense business surfaces default to sm. */
export default function CompactButton({
  emphasis = "text", size = "sm", className = "", type = "button", ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { emphasis?: "text" | "primary"; size?: "sm" | "md" }) {
  return <button {...props} type={type} data-size={size} data-density="compact"
    className={`compact-button compact-button--${emphasis} ${className}`} />;
}
