import { requireCRM } from "@/server/auth";
import { canManage } from "@/domain/permissions";
import { db } from "@/server/db";
import { settingsAction } from "@/estimator/server/actions";
import EstimatorNav from "@/estimator/components/nav";
export default async function Settings({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const u = await requireCRM();
  const { error } = await searchParams;
  const s = await db.estimatorSettings.findUnique({ where: { id: "company" } });
  return (
    <>
      <h1>Estimator business information</h1>
      <EstimatorNav />
      {error && <p className="error">{error}</p>}
      <section className="panel">
        <p>
          Provide your approved business contact information and proposal terms.
          Do not add unverified license, insurance or warranty claims. These
          settings snapshot into newly saved drafts.
        </p>
        {canManage(u.role) ? (
          <form action={settingsAction} className="form">
            <label>
              Company name
              <input
                name="companyName"
                defaultValue={s?.companyName ?? "Flipas Home Remodeling"}
                required
                maxLength={200}
              />
            </label>
            <label>
              Brand color
              <input
                type="color"
                name="brandingColor"
                defaultValue={s?.brandingColor ?? "#172b30"}
              />
            </label>
            <label className="wide">
              Public business contact information
              <textarea
                name="contactInfo"
                defaultValue={s?.contactInfo ?? ""}
                maxLength={4000}
              />
            </label>
            <label className="wide">
              Business-owner reviewed terms and conditions
              <textarea
                name="terms"
                defaultValue={s?.terms ?? ""}
                maxLength={4000}
              />
            </label>
            <label>
              Significant discount threshold ratio (0 = any discount)
              <input
                type="number"
                name="significantDiscountThreshold"
                min="0"
                max="1"
                step="0.0001"
                defaultValue={s?.significantDiscountThreshold.toString() ?? "0"}
                required
              />
            </label>
            <button>Save business information</button>
          </form>
        ) : (
          <p>
            Only Owner/Admin can configure business information and approval
            policy.
          </p>
        )}
      </section>
    </>
  );
}
