import { useState } from "react";
import { Link, Redirect } from "wouter";
import { ArrowRight, Loader2, Lock, Mail, User } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { QuorumLogo, QuorumMark } from "@/components/brand";
import { Btn, Field, Input } from "@/components/design";
import { cn } from "@/lib/utils";

const seats = [
  { role: "Strategy", initials: "CS", color: "#3D4A5C" },
  { role: "Finance", initials: "CF", color: "#3F5B52" },
  { role: "Legal", initials: "GC", color: "#6B4A4A" },
  { role: "Growth", initials: "CM", color: "#8A6A3B" },
  { role: "Operations", initials: "CO", color: "#4A5568" },
];

export default function AuthPage() {
  const { user, loginMutation, registerMutation } = useAuth();
  const { toast } = useToast();
  const params = new URLSearchParams(window.location.search);
  const [mode, setMode] = useState<"login" | "register">(params.get("mode") === "register" ? "register" : "login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  if (user) return <Redirect to="/" />;

  const pending = loginMutation.isPending || registerMutation.isPending;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setLocalError(null);
    if (!username.trim() || !password) {
      setLocalError("Enter a username and password.");
      return;
    }
    if (mode === "register") {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setLocalError("Enter a valid email address.");
        return;
      }
      if (password.length < 6) {
        setLocalError("Use at least 6 characters for your password.");
        return;
      }
      if (password !== confirmPassword) {
        setLocalError("Those passwords do not match.");
        return;
      }
      registerMutation.mutate({ username: username.trim(), email: email.trim(), password });
    } else {
      loginMutation.mutate({ username: username.trim(), password });
    }
  };

  const devLogin = async () => {
    try {
      const response = await fetch("/api/dev-login", { method: "POST", credentials: "include" });
      if (!response.ok) throw new Error(response.statusText);
      const devUser = await response.json();
      queryClient.setQueryData(["/api/user"], devUser);
    } catch (error) {
      toast({
        title: "Local sign-in failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[0.92fr_1.08fr]">
      {/* Editorial panel */}
      <aside className="relative hidden overflow-hidden bg-[hsl(220_24%_9%)] p-12 lg:flex lg:flex-col lg:justify-between">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.16]"
          style={{
            background:
              "radial-gradient(620px 420px at 18% 8%, hsl(38 46% 60%), transparent 62%), radial-gradient(520px 460px at 92% 92%, hsl(158 26% 40%), transparent 60%)",
          }}
        />
        <div className="relative">
          <Link href="/">
            <QuorumLogo onDark />
          </Link>
        </div>

        <div className="relative max-w-[420px]">
          <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-[hsl(38_32%_62%)]">The chair's advantage</p>
          <blockquote className="mt-5 font-display text-[30px] leading-[1.18] text-[hsl(40_24%_94%)]">
            “The value of a board is not agreement.
            <span className="mt-1 block italic text-[hsl(38_46%_70%)]">It is the argument you did not have.”</span>
          </blockquote>
          <p className="mt-4 text-[12.5px] leading-relaxed text-[hsl(40_8%_62%)]">
            Quorum gives an operator five functional voices, one table, and a written record of
            where they diverged.
          </p>

          <div className="mt-10 flex items-center gap-2.5">
            {seats.map((seat) => (
              <span
                key={seat.role}
                title={seat.role}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 text-[10px] font-semibold text-white/90"
                style={{ background: seat.color }}
              >
                {seat.initials}
              </span>
            ))}
            <span className="ml-1 flex h-9 w-9 items-center justify-center rounded-full border border-dashed border-white/25 text-white/50">
              <QuorumMark size={16} />
            </span>
          </div>
        </div>

        <div className="relative flex items-center gap-6 text-[10.5px] uppercase tracking-[0.14em] text-[hsl(40_10%_62%)]">
          <span>Private workspace</span>
          <span>Your model keys</span>
          <span>Export always</span>
        </div>
      </aside>

      {/* Form panel */}
      <main className="flex justify-center px-5 py-10 sm:px-10">
        <div className="flex min-h-[calc(100vh-5rem)] w-full max-w-[420px] flex-col">
          <div className="my-auto py-6">
          <div className="mb-9 flex items-center justify-between lg:hidden">
            <Link href="/">
              <QuorumLogo compact />
            </Link>
            <Link href="/" className="text-[12px] text-muted-ink hover:text-ink">Back</Link>
          </div>

          <p className="eyebrow">{mode === "login" ? "Welcome back" : "Take a seat"}</p>
          <h1 className="mt-3 font-display text-[38px] leading-[1.05] text-ink">
            {mode === "login" ? "Return to the boardroom." : "Convene your first board."}
          </h1>
          <p className="mt-3 text-[13.5px] leading-relaxed text-muted-ink">
            {mode === "login"
              ? "Sign in to pick up the decision in progress."
              : "Create a workspace, state a decision, and seat three directors on the house."}
          </p>

          <div className="mt-8 grid grid-cols-2 rounded-lg border border-line bg-surface p-1">
            {(["login", "register"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => { setMode(value); setLocalError(null); }}
                className={cn(
                  "h-8 rounded-md text-[12.5px] font-medium transition-colors",
                  mode === value ? "bg-ink text-paper" : "text-muted-ink hover:text-ink",
                )}
              >
                {value === "login" ? "Sign in" : "Create account"}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <Field label="Username">
              <div className="relative">
                <User className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint-ink" />
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  placeholder="e.g. maren"
                  className="pl-9"
                  required
                />
              </div>
            </Field>

            {mode === "register" && (
              <Field label="Work email">
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint-ink" />
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    placeholder="you@company.com"
                    className="pl-9"
                    required
                  />
                </div>
              </Field>
            )}

            <Field label="Password" hint={mode === "register" ? "6+ characters" : undefined}>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint-ink" />
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  placeholder="••••••••"
                  className="pl-9"
                  required
                />
              </div>
            </Field>

            {mode === "register" && (
              <Field label="Confirm password">
                <Input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  placeholder="••••••••"
                  required
                />
              </Field>
            )}

            {localError && (
              <p role="alert" className="rounded-md border border-oxblood/25 bg-oxblood-wash px-3 py-2 text-[12.5px] text-oxblood">
                {localError}
              </p>
            )}

            <Btn type="submit" variant="bronze" size="lg" className="w-full" disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {mode === "login" ? "Sign in" : "Create workspace"}
              {!pending && <ArrowRight className="h-4 w-4" />}
            </Btn>
          </form>

          <p className="mt-4 text-center text-[12px] leading-relaxed text-muted-ink">
            By continuing you agree that Quorum's directors provide advice, not legal or financial
            fact. Bring consequential calls to a qualified professional.
          </p>

          {import.meta.env.DEV && (
            <div className="mt-8 border-t border-line pt-5">
              <button
                type="button"
                onClick={devLogin}
                className="text-[11.5px] text-faint-ink underline decoration-line-strong underline-offset-4 hover:text-ink"
              >
                Local development sign-in
              </button>
            </div>
          )}

          </div>

          <div className="flex items-center justify-between border-t border-line pt-5 text-[11.5px] text-muted-ink">
            <Link href="/" className="hover:text-ink">← Back to the product</Link>
            <a href="mailto:admin@desmond-digital.com" className="hover:text-ink">Need access?</a>
          </div>
        </div>
      </main>
    </div>
  );
}
