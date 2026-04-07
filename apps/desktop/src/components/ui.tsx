import { splitProps, type JSX } from "solid-js";

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

interface TextareaProps extends JSX.TextareaHTMLAttributes<HTMLTextAreaElement> {}

export function Textarea(props: TextareaProps) {
  const [local, rest] = splitProps(props, ["class"]);
  return <textarea class={`ra-textarea ${local.class ?? ""}`} {...rest} />;
}

interface IconButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "danger";
  label: string;
  children: JSX.Element;
}

export function IconButton(props: IconButtonProps) {
  const { variant = "default", class: className, label, children, ...rest } = props;
  return (
    <button
      type="button"
      class={`ra-icon-button ${variant === "danger" ? "ra-icon-button--danger" : ""} ${className ?? ""}`}
      aria-label={label}
      title={label}
      {...rest}
    >
      {children}
    </button>
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
