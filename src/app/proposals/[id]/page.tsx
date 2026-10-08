import Decimal from "decimal.js";
import { requireCRM } from "@/server/auth";
import { readEstimate } from "@/estimator/server/service";
import { proposalDTO } from "@/estimator/domain/proposal";
export default async function Proposal({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const p = proposalDTO(await readEstimate(await requireCRM(), id));
  return (
    <main className="proposal">
      <header>
        <p className="eyebrow">Remodeling proposal</p>
        <h1>{p.company.name}</h1>
        <p style={{ whiteSpace: "pre-wrap" }}>
          {p.company.contact || "[Business contact information pending]"}
        </p>
        {p.draft && <p className="draft-banner">DRAFT — NOT RELEASED</p>}
        <h2>
          {p.number} · Revision {p.revision}
        </h2>
        <p>
          Prepared for {p.customer.name}
          <br />
          {p.customer.email} · {p.customer.phone}
          <br />
          {p.address}
        </p>
        <p>Valid through {p.expiresAt}</p>
      </header>
      <section>
        <h2>Scope of work</h2>
        <p style={{ whiteSpace: "pre-wrap" }}>{p.scope}</p>
      </section>
      {p.sections.map((s, i) => (
        <section key={i}>
          <h2>{s.name}</h2>
          <table>
            <thead>
              <tr>
                <th>Service</th>
                <th>Quantity</th>
                <th>Unit price</th>
                <th>Investment</th>
              </tr>
            </thead>
            <tbody>
              {s.lines.map((l, j) => (
                <tr key={j}>
                  <td>
                    {l.name}
                    <p className="muted">{l.description}</p>
                  </td>
                  <td>
                    {l.quantity} {l.unit}
                  </td>
                  <td>${l.unitPrice}</td>
                  <td>${l.price}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      <section>
        <p>
          Discount: ${p.discount}
          <br />
          Net selling price: ${p.netPrice}
          <br />
          Configured tax: ${p.tax}
        </p>
        <h2>Total investment · ${p.total}</h2>
        {p.durationDays && <p>Estimated duration: {p.durationDays} days</p>}
      </section>
      <section>
        <h2>Payment milestones</h2>
        {p.milestones.map((m, i) => (
          <p key={i}>
            {m.label} · {new Decimal(m.percentage).mul(100).toString()}%
          </p>
        ))}
      </section>
      {[
        ["Inclusions", p.inclusions],
        ["Exclusions", p.exclusions],
        ["Terms and conditions", p.company.terms],
      ].map(([name, text]) => (
        <section key={name}>
          <h2>{name}</h2>
          <p style={{ whiteSpace: "pre-wrap" }}>
            {text || "[Business-owner review pending]"}
          </p>
        </section>
      ))}
      <section>
        <h2>Customer acceptance</h2>
        <p>Name: __________________________</p>
        <p>Signature: _______________________</p>
        <p>Date: ___________________________</p>
      </section>
      <a className="button no-print" href={`/api/estimates/${id}/pdf`}>
        Download PDF
      </a>
    </main>
  );
}
