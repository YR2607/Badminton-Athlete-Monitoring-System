import { getDictionary } from "@/i18n";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const dict = getDictionary("ru");
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight">{dict.app.name}</h1>
          <p className="mt-1 text-sm text-muted">{dict.app.tagline}</p>
        </div>
        <LoginForm dict={dict} />
      </div>
    </main>
  );
}
