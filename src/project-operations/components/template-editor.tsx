"use client";
import { useState } from "react";
import { templateAction } from "../server/actions";
export function TemplateEditor({
  name,
  initial,
}: {
  name: string;
  initial: { title: string; tasks: string[] }[];
}) {
  const [stages, setStages] = useState(initial);
  function change(index: number, value: { title: string; tasks: string[] }) {
    setStages(stages.map((s, i) => (i === index ? value : s)));
  }
  return (
    <form action={templateAction}>
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
                change(i, { ...s, tasks: e.target.value.split("\n") })
              }
              rows={5}
              required
            />
          </label>
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
      <button>Save new version</button>
    </form>
  );
}
