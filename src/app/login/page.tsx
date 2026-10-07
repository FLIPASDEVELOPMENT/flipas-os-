import { login } from "../actions";
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="login panel">
      <p className="eyebrow">Flipas Home Remodeling</p>
      <h1>FLIPAS OS</h1>
      <p className="muted">AI-Powered Remodeling Operations</p>
      <h2>Sign in to your workspace</h2>
      {error && (
        <p className="error" role="alert">
          {error === "limited"
            ? "Too many attempts. Try again in 15 minutes."
            : "Unable to sign in. Check your credentials."}
        </p>
      )}
      <form action={login} className="form">
        <label className="wide">
          Email
          <input name="email" type="email" autoComplete="username" required />
        </label>
        <label className="wide">
          Password
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={256}
          />
        </label>
        <button className="wide">Sign in</button>
      </form>
      <p className="muted">Accounts are provisioned by your administrator.</p>
    </main>
  );
}
