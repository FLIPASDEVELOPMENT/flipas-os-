"use client";
import { Submit } from "./submit";
import { useState } from "react";
import { templateAction } from "../server/actions";
export function TemplateEditor({
  name,
  initial,
  recommended,
}: {
  name: string;
  initial: {
    title: string;
    tasks: string[];
    checklists?: Record<string, string[]>;
  }[];
  recommended?: typeof initial;
}) {
  const [stages, setStages] = useState(initial);
  function change(
    index: number,
    value: {
      title: string;
      tasks: string[];
      checklists?: Record<string, string[]>;
    },
  ) {
    setStages(stages.map((s, i) => (i === index ? value : s)));
  }
  return (
    <form action={templateAction}>
      {recommended && (
        <button
          type="button"
          onClick={() => {
            if (
              window.confirm(
                "Load the recommended procedure into this editor? Existing saved versions and project tasks stay unchanged until you explicitly save a new version.",
              )
            )
              setStages(recommended);
          }}
        >
          Review recommended procedure
        </button>
      )}
      <label>
        Template name
        <input name="name" defaultValue={name} required />
      </label>
      <input
        type="hidden"
        name="definition"
        value={JSON.stringify({ stages })}
      />
      {stages.map((s, i) => (
        <fieldset key={i}>
          <legend>Stage {i + 1}</legend>
          <label>
            Stage title
            <input
              value={s.title}
              onChange={(e) => change(i, { ...s, title: e.target.value })}
              required
              maxLength={2000}
            />
          </label>
          <label>
            Tasks (one per line)
            <textarea
              value={s.tasks.join("\n")}
              onChange={(e) =>
                change(i, {
                  ...s,
                  tasks: e.target.value.split("\n"),
                  checklists: Object.fromEntries(
                    Object.entries(s.checklists ?? {}).filter(([key]) =>
                      e.target.value.split("\n").includes(key),
                    ),
                  ),
                })
              }
              rows={5}
              required
            />
          </label>
          {s.tasks.filter(Boolean).map((task) => (
            <label key={task}>
              Required criteria: {task}
              <textarea
                rows={3}
                value={(
                  s.checklists?.[task] ?? [
                    "Confirm completion and record evidence",
                  ]
                ).join("\n")}
                onChange={(e) =>
                  change(i, {
                    ...s,
                    checklists: {
                      ...s.checklists,
                      [task]: e.target.value.split("\n"),
                    },
                  })
                }
              />
            </label>
          ))}
          <button
            type="button"
            onClick={() => setStages(stages.filter((_, index) => index !== i))}
          >
            Remove stage
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        disabled={stages.length >= 20}
        onClick={() =>
          setStages([...stages, { title: "New stage", tasks: ["New task"] }])
        }
      >
        Add stage
      </button>
      <Submit confirm="Publish this new execution-template version? Existing project snapshots will not change.">
        Save new version
      </Submit>
    </form>
  );
}
