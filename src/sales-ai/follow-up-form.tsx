"use client";
import { useState } from "react";
import { threadAction } from "./actions";
export function FollowUpForm({ id }: { id: string }) {
  const [date, setDate] = useState("");
  return (
    <form action={threadAction} className="form">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="operation" value="followup" />
      <input type="hidden" name="dueAt" value={date} />
      <label>
        Follow-up date & time
        <input
          type="datetime-local"
          required
          onChange={(e) =>
            setDate(
              e.target.value ? new Date(e.target.value).toISOString() : "",
            )
          }
        />
        <small>Uses your computer’s local time zone.</small>
      </label>
      <label>
        Next action
        <input
          name="reason"
          required
          maxLength={1000}
          placeholder="Confirm address and visit availability"
        />
      </label>
      <button>Create follow-up task</button>
    </form>
  );
}
