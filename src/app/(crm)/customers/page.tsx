import Link from "next/link";
import { requireCRM } from "@/server/auth";
import { db } from "@/server/db";
import { customerScope } from "@/server/crm";
import { createCustomer } from "@/app/actions";
export default async function Customers() {
  const u = await requireCRM();
  const rows = await db.customer.findMany({
    where: customerScope(u),
    orderBy: { lastName: "asc" },
    take: 200,
  });
  return (
    <>
      <h1>Customers</h1>
      <p className="muted">
        The central record for every relationship. Showing up to 200 customers.
      </p>
      <section className="panel">
        <table>
          <thead>
            <tr>
              <th>Customer</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Location</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link href={`/customers/${c.id}`}>
                    {c.firstName} {c.lastName}
                  </Link>
                </td>
                <td>{c.email ?? "—"}</td>
                <td>{c.phone ?? "—"}</td>
                <td>
                  {c.city} {c.state}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <p className="empty">
            No customers yet. Add your first customer below.
          </p>
        )}
      </section>
      <section className="panel">
        <h2>Add customer</h2>
        <form action={createCustomer} className="form">
          {[
            "firstName",
            "lastName",
            "email",
            "phone",
            "address",
            "city",
            "state",
            "zip",
          ].map((name) => (
            <label key={name}>
              {name.replace(/([A-Z])/g, " $1")}
              <input
                name={name}
                type={name === "email" ? "email" : "text"}
                required={["firstName", "lastName", "state"].includes(name)}
                defaultValue={name === "state" ? "FL" : undefined}
                maxLength={name === "state" ? 2 : 254}
              />
            </label>
          ))}
          <label className="wide">
            Notes
            <textarea name="notes" maxLength={2000} />
          </label>
          <button>Create customer</button>
        </form>
        {u.role === "SALES" && (
          <p className="muted">
            An intake lead is assigned to you when you add a customer.
          </p>
        )}
      </section>
    </>
  );
}
