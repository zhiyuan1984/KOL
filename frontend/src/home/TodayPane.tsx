import { useState } from "react";
import type { RecommendedTask, Task } from "../api";
import { recIcon } from "../recommendedTasks";
import { recommendationSourceLabel } from "./modes";
import { findDuplicateTodo, recommendationIdentity } from "./todoDedupe";
import {
  canOpenExistingTaskFlow,
  handleLine,
  isHighValueInsight,
  nextStepLine,
  todoBucket,
  urgencyLabel,
  dueLabel,
  whyLine,
} from "./homeModel";
import "./today-rec-row.css";

const TODAY_FOLD_LIMIT = 3;

function GoArrow() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
      <path
        d="M5 12h14M13 6l6 6-6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
