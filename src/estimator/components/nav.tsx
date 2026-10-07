import Link from "next/link";
export default function EstimatorNav() {
  return (
    <nav className="estimator-nav">
      <Link href="/estimates">Estimates</Link>
      <Link href="/estimates/new">New estimate</Link>
      <Link href="/estimates/catalog">Pricing catalog</Link>
      <Link href="/estimates/templates">Scope templates</Link>
      <Link href="/estimates/settings">Business information</Link>
    </nav>
  );
}
