import {
  Customer,
  Lead,
  User,
  LeadSource,
  LeadStatus,
} from "@/generated/prisma/client";
import { saveLead } from "@/app/actions";
export function LeadForm({
  customers,
  users,
  lead,
}: {
  customers: Customer[];
  users: Pick<User, "id" | "name">[];
  lead?: Lead;
}) {
  return (
    <form action={saveLead} className="form">
      <input type="hidden" name="id" value={lead?.id ?? ""} />
      <label>
        Customer
        <select name="customerId" defaultValue={lead?.customerId} required>
          {customers.map((c) => (
            <option value={c.id} key={c.id}>
              {c.firstName} {c.lastName}
            </option>
          ))}
        </select>
      </label>
      <label>
        Service
        <input
          name="serviceType"
          defaultValue={lead?.serviceType}
          required
          maxLength={100}
        />
      </label>
      <label>
        Source
        <select name="source" defaultValue={lead?.source ?? "WEBSITE"}>
          {Object.values(LeadSource).map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </label>
      <label>
        Status
        <select name="status" defaultValue={lead?.status ?? "NEW"}>
          {Object.values(LeadStatus).map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </label>
      <label>
        Lead score (0–100)
        <input
          name="leadScore"
          type="number"
          min="0"
          max="100"
          defaultValue={lead?.leadScore ?? 0}
        />
      </label>
      <label>
        Assigned salesperson
        <select name="assignedToId" defaultValue={lead?.assignedToId ?? ""}>
          <option value="">Unassigned</option>
          {users.map((u) => (
            <option value={u.id} key={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Budget minimum (USD)
        <input
          name="budgetMin"
          type="number"
          min="0"
          step="0.01"
          defaultValue={lead?.budgetMin?.toString()}
        />
      </label>
      <label>
        Budget maximum (USD)
        <input
          name="budgetMax"
          type="number"
          min="0"
          step="0.01"
          defaultValue={lead?.budgetMax?.toString()}
        />
      </label>
      <label>
        Desired start date
        <input
          name="desiredStartDate"
          type="date"
          defaultValue={lead?.desiredStartDate?.toISOString().slice(0, 10)}
        />
      </label>
      <label className="wide">
        Description
        <textarea
          name="description"
          defaultValue={lead?.description ?? ""}
          maxLength={2000}
        />
      </label>
      <button>{lead ? "Save changes" : "Create lead"}</button>
    </form>
  );
}
