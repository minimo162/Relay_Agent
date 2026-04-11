import { createSignal } from "solid-js";
import type { Approval, UserQuestion } from "../components/shell-types";

export function createApprovalStore() {
  const [approvals, setApprovals] = createSignal<Approval[]>([]);
  const [userQuestions, setUserQuestions] = createSignal<UserQuestion[]>([]);

  const clearPending = () => {
    setApprovals([]);
    setUserQuestions([]);
  };

  const removeApproval = (approvalId: string) => {
    setApprovals((prev) => prev.filter((a) => a.approvalId !== approvalId));
  };

  const removeQuestion = (questionId: string) => {
    setUserQuestions((prev) => prev.filter((q) => q.questionId !== questionId));
  };

  return {
    approvals,
    setApprovals,
    userQuestions,
    setUserQuestions,
    clearPending,
    removeApproval,
    removeQuestion,
  };
}
