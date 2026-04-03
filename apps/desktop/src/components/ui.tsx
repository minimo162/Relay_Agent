import { type JSX } from "solid-js";

/**
 * Minimal button component — OpenWork-style pill button
 */
interface ButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost";
  children: JSX.Element;
}

export function Button(props: ButtonProps) {
  const { variant = "secondary", class: className, ...rest } = props;
  return (
    <button
      class={`ra-button ra-button-${variant} ${className ?? ""}`}
      {...rest}
    />
  );
}

/**
 * Minimal input
 */
interface InputProps extends JSX.InputHTMLAttributes<HTMLInputElement> {}

export function Input(props: InputProps) {
  return <input class={`ra-input ${props.class ?? ""}`} {...props} />;
}

/**
 * Status dot indicator
 */
interface StatusDotProps {
  status: "connected" | "connecting" | "disconnected";
  label?: string;
}

export function StatusDot(props: StatusDotProps) {
  return (
    <span
      class={`ra-status-dot ra-status-dot--${props.status}`}
      title={props.label ?? props.status}
    />
  );
}
