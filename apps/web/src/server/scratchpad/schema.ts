import { z } from "zod";
import { SCRATCHPAD_MAX_ENTRY } from "./format";

export const AppendRequestSchema = z.object({
  text: z.string().min(1).max(SCRATCHPAD_MAX_ENTRY),
});

export const OBJECT_KINDS = ["person", "project", "organization", "concept", "tool", "asset", "goal"] as const;

/** What the model may suggest per entry. `keep` = unsure, leave it in the pad. */
export const SUGGESTION_ACTIONS = ["note", "task", "object", "discard", "keep"] as const;

export const SuggestionSchema = z.object({
  entry_id: z.string().min(1).max(40),
  action: z.enum(SUGGESTION_ACTIONS),
  /** note: title; task: task text */
  title: z.string().trim().max(300).nullish(),
  /** object: id of an existing object to append the entry to */
  target_item_id: z.string().uuid().nullish(),
  reason: z.string().trim().max(300).nullish(),
});
export type Suggestion = z.infer<typeof SuggestionSchema>;

export const CleanupOutputSchema = z.object({ suggestions: z.array(SuggestionSchema).max(200) });

/** Accepted decisions sent back by the client (apply); `discard` only removes the entry. */
export const DecisionSchema = z.object({
  entry_id: z.string().min(1).max(40),
  action: z.enum(["note", "task", "object", "discard"]),
  title: z.string().trim().max(300).nullish(),
  target_item_id: z.string().uuid().nullish(),
});
export type Decision = z.infer<typeof DecisionSchema>;

export const ApplyRequestSchema = z.object({ decisions: z.array(DecisionSchema).min(1).max(200) });
