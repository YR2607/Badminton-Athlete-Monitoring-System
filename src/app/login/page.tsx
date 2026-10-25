import { getDictionary } from "@/i18n";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const dict = getDictionary("ru");
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mb-3 inline-flex items-center gap-2.5">
            <span aria-hidden className="inline-block h-6 w-2 -skew-x-12 rounded-[3px] bg-accent" />
            <h1 className="font-display text-2xl font-bold tracking-wide">{dict.app.name}</h1>
          </div>
          <p className="mt-1 text-sm text-muted">{dict.app.tagline}</p>
        </div>
        <LoginForm dict={dict} />
      </div>
    </main>
  );
}
