import { useRef } from "react";
import type { KeyboardEvent } from "react";
import type { ZCodePlanPreference } from "./capacityTypes";
import "./PlanSegmented.css";

const PLAN_OPTIONS: ReadonlyArray<{ value: ZCodePlanPreference; short: string; name: string }> = [
  { value: "start", short: "体验", name: "体验套餐" },
  { value: "coding", short: "个人", name: "个人套餐" },
];

interface PlanSegmentedProps {
  value: ZCodePlanPreference;
  onChange: (next: ZCodePlanPreference) => void;
}

export function PlanSegmented({ value, onChange }: PlanSegmentedProps) {
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const select = (next: ZCodePlanPreference) => {
    if (next !== value) onChange(next);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const index = PLAN_OPTIONS.findIndex(option => option.value === value);
    let next = -1;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index + PLAN_OPTIONS.length - 1) % PLAN_OPTIONS.length;
    else if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % PLAN_OPTIONS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = PLAN_OPTIONS.length - 1;
    if (next < 0) return;
    event.preventDefault();
    select(PLAN_OPTIONS[next].value);
    optionRefs.current[next]?.focus();
  };
  return <span className="plan-segmented" role="radiogroup" aria-label="ZCode 套餐" data-plan={value} onKeyDown={onKeyDown}>
    <span className="plan-segmented-indicator" aria-hidden="true" />
    {PLAN_OPTIONS.map((option, index) => <button
      key={option.value} type="button" role="radio" aria-label={option.name} aria-checked={option.value === value}
      tabIndex={option.value === value ? 0 : -1} ref={node => { optionRefs.current[index] = node; }}
      onClick={() => select(option.value)}>
      <span aria-hidden="true">{option.short}</span>
    </button>)}
  </span>;
}
