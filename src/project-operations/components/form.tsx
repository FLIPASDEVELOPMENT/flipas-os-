import { Submit } from "./submit";
import { randomUUID } from "node:crypto";
import { projectAction } from "../server/actions";
export type Field = {
  name: string;
  label?: string;
  type?: string;
  value?: string | number;
  options?: { value: string; label: string }[];
  optional?: boolean;
};
export function OperationForm({
  projectId,
  operation,
  title,
  fields,
}: {
  projectId: string;
  operation: string;
  title: string;
  fields: Field[];
}) {
  return (
    <details className="operation-form">
      <summary>{title}</summary>
      <form action={projectAction}>
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="operation" value={operation} />
        <input type="hidden" name="requestKey" value={randomUUID()} />
        {fields.map((f) =>
          f.type === "hidden" ? (
            <input key={f.name} type="hidden" name={f.name} value={f.value} />
          ) : (
            <label key={f.name}>
              {f.label ?? f.name.replaceAll(/([A-Z])/g, " $1")}
              {f.options ? (
                <select
                  name={f.name}
                  multiple={f.name === "workers"}
                  defaultValue={
                    f.name === "workers"
                      ? String(f.value ?? "")
                          .split(",")
                          .filter(Boolean)
                      : f.value
                  }
                >
                  {f.optional && <option value="">Unassigned</option>}
                  {f.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : f.type === "textarea" ? (
                <textarea
                  name={f.name}
                  defaultValue={f.value}
                  required={!f.optional}
                  maxLength={2000}
                />
              ) : (
                <input
                  name={f.name}
                  type={f.type ?? "text"}
                  defaultValue={f.value}
                  required={!f.optional}
                  maxLength={2000}
                  step={f.type === "number" ? "1" : undefined}
                />
              )}
            </label>
          ),
        )}
        <Submit
          confirm={
            [
              "state",
              "change-approve",
              "change-apply",
              "change-reject",
              "cost-review",
              "purchase-state",
              "template",
            ].includes(operation)
              ? `Confirm ${title.toLowerCase()}? This action is validated and audited.`
              : undefined
          }
        >
          Save {title.toLowerCase()}
        </Submit>
      </form>
    </details>
  );
}
export function EvidenceForm({
  projectId,
  target,
  id,
}: {
  projectId: string;
  target: "taskId" | "logId" | "inspectionId";
  id: string;
}) {
  return (
    <form
      action={`/api/projects/${projectId}/evidence`}
      method="post"
      encType="multipart/form-data"
    >
      <input type="hidden" name={target} value={id} />
      <label>
        Photo evidence (JPEG, PNG, WebP; 5 MB)
        <input
          type="file"
          name="file"
          accept="image/jpeg,image/png,image/webp"
          required
        />
      </label>
      <button>Upload evidence</button>
    </form>
  );
}
