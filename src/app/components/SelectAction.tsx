"use client";

import { useTransition } from "react";

/**
 * A <select> that fires a bound server action the moment the value changes.
 * Keeps the rest of the app server-rendered: no client state, no form buttons.
 */
export default function SelectAction({
  action,
  defaultValue,
  options,
  label,
}: {
  action: (value: string) => Promise<void> | void;
  defaultValue: string;
  options: Array<{ value: string; label: string }>;
  label: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <select
      aria-label={label}
      value={defaultValue}
      disabled={pending}
      onChange={(e) => {
        const value = e.target.value;
        startTransition(() => {
          void action(value);
        });
      }}
      style={{ padding: "5px 7px", fontSize: 12.5, width: "auto" }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
