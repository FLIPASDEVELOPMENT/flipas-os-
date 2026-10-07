"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <section className="panel" role="alert">
      <h1>Unable to complete this request</h1>
      <p>
        Check the input and your access. If the issue persists, contact your
        administrator.
      </p>
      <button onClick={reset}>Try again</button>
    </section>
  );
}
