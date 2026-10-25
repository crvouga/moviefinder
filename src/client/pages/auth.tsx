import { useEffect, useState } from "react";
import { useLocation } from "@tanstack/react-router";
import { Film } from "lucide-react";
import { authClient } from "../auth-client";
import { safeReturnTo } from "../../shared/contracts";

export function AuthPage() {
  const location = useLocation();
  const params = new URLSearchParams(location.searchStr);
  const [availability, setAvailability] = useState<"checking" | "ready" | "unavailable">(
    "checking",
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    params.has("socialError") ? "We couldn’t complete your sign-in. Please try again." : "",
  );
  async function checkAvailability(signal?: AbortSignal) {
    setAvailability("checking");
    try {
      const response = await fetch("/api/auth-options", { signal });
      if (!response.ok) throw new Error("Unavailable");
      const options = await response.json();
      setAvailability(options.google === true ? "ready" : "unavailable");
    } catch {
      if (!signal?.aborted) setAvailability("unavailable");
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    void checkAvailability(controller.signal);
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) setBusy(false);
    };
    window.addEventListener("pageshow", restore);
    return () => window.removeEventListener("pageshow", restore);
  }, []);
  async function signInWithGoogle() {
    setBusy(true);
    setMessage("");
    try {
      const returnTo = safeReturnTo(params.get("returnTo"));
      const errorURL = new URL("/auth", window.location.origin);
      errorURL.searchParams.set("socialError", "1");
      errorURL.searchParams.set("returnTo", returnTo);
      const result = await authClient.signIn.social({
        provider: "auth-relay",
        callbackURL: returnTo,
        errorCallbackURL: errorURL.href,
      });
      if (result.error) throw new Error("Unavailable");
    } catch {
      setMessage("Google sign-in is unavailable right now. Please try again.");
      setBusy(false);
    }
  }
  return (
    <main className="auth-screen">
      <section className="auth-art" aria-label="Welcome to MovieFinder">
        <a href="/auth" className="brand">
          <span className="brand-icon">
            <Film size={19} />
          </span>
          moviefinder<span className="brand-dot">.</span>
        </a>
        <div className="auth-art-copy">
          <span className="eyebrow">FOR THE LOVE OF A GOOD STORY</span>
          <h1>
            Less scrolling.
            <br />
            More <em>cinema.</em>
          </h1>
          <p>
            The next film you love is out there.
            <br />
            Find it. Make a list. Bring your people.
          </p>
          <div className="auth-art-line" />
        </div>
        <span className="auth-note">A little curiosity. A great movie night.</span>
      </section>
      <section className="auth-form-wrap" aria-labelledby="auth-title">
        <a href="/auth" className="auth-mobile-brand">
          <Film aria-hidden="true" /> moviefinder.
        </a>
        <div className="auth-form">
          <span className="eyebrow">A GOOD NIGHT STARTS HERE</span>
          <h2 id="auth-title">
            Your next great
            <br />
            watch awaits.
          </h2>
          <p>
            Save what catches your eye. Make a collection.
            <br className="auth-desktop-break" /> Find something you’ll love.
          </p>
          <button
            className="google-signin"
            type="button"
            aria-label="Sign in with Google"
            disabled={availability !== "ready" || busy}
            onClick={() => void signInWithGoogle()}
          >
            <img src="/brand/google-signin-light.png" width="216" height="48" alt="" />
          </button>
          <p className="auth-account-note">One sign-in. A world of good stories.</p>
          <div className="auth-feedback" role="status" aria-live="polite">
            {availability === "unavailable" ? (
              <>
                <p>Sign-in is temporarily unavailable.</p>
                <button className="auth-retry" onClick={() => void checkAvailability()}>
                  Try again
                </button>
              </>
            ) : message ? (
              <p>{message}</p>
            ) : busy ? (
              <p>Opening Google…</p>
            ) : null}
          </div>
          <p className="auth-fine">New here? Your account is created when you sign in.</p>
        </div>
      </section>
    </main>
  );
}
