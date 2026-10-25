import { getDictionary } from "@/i18n";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const dict = getDictionary("ru");
  return (
    <main className="court-lines relative flex min-h-dvh items-center justify-center overflow-hidden px-4">
      <div className="relative w-full max-w-sm">
        <div className="mb-8 text-center">
          <div
            aria-hidden
            className="mx-auto mb-4 h-4 w-10 bg-accent"
            style={{ clipPath: "polygon(0 0, 100% 22%, 100% 100%, 0 78%)" }}
          />
          <h1 className="font-display text-4xl font-bold uppercase tracking-wide">
            {dict.app.name}
          </h1>
          <p className="mt-2 text-sm text-muted">{dict.app.tagline}</p>
        </div>
        <LoginForm dict={dict} />
      </div>
    </main>
  );
}
