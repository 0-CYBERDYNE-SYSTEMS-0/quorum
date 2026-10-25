import { Component, type ErrorInfo, type ReactNode } from "react";
import { Switch, Route } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { QuorumLogo } from "@/components/brand";
import { Btn } from "@/components/design";
import LandingPage from "@/pages/landing";
import WorkspacePage from "@/pages/workspace";
import AuthPage from "@/pages/auth-page";
import SubscribePage from "@/pages/subscribe-page";
import NotFoundPage from "@/pages/not-found";

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Quorum render error:", error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-paper px-6">
          <div className="w-full max-w-md rounded-xl border border-line bg-surface p-8 text-center shadow-quiet">
            <QuorumLogo className="justify-center" />
            <h1 className="mt-6 font-display text-2xl text-ink">The room lost its place.</h1>
            <p className="mt-2 text-[13px] leading-relaxed text-muted-ink">
              Quorum hit an unexpected error rendering this view. Your sessions and record are safe.
            </p>
            <Btn variant="primary" size="sm" className="mt-5" onClick={() => window.location.reload()}>
              Reload the boardroom
            </Btn>
            <details className="mt-4 text-left">
              <summary className="cursor-pointer text-[11px] text-faint-ink">Technical detail</summary>
              <pre className="mt-2 overflow-x-auto rounded bg-slatewash p-2 font-mono text-[10.5px] text-oxblood">
                {this.state.error.message}
              </pre>
            </details>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function Home() {
  const { user, isLoading } = useAuth();
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <span className="h-5 w-5 animate-pulse rounded-full border border-bronze" />
      </div>
    );
  }
  return user ? <WorkspacePage /> : <LandingPage />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <Switch>
            <Route path="/" component={Home} />
            <Route path="/auth" component={AuthPage} />
            <Route path="/subscribe" component={SubscribePage} />
            <Route component={NotFoundPage} />
          </Switch>
          <Toaster />
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
