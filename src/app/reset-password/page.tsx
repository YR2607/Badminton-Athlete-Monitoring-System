import { getDictionary } from "@/i18n";
import { updatePassword } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";

export default async function ResetPasswordPage() {
  const dict = getDictionary("ru");
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardContent className="pt-6">
          <h1 className="mb-4 text-lg font-semibold">{dict.auth.newPassword}</h1>
          <form
            action={async (fd) => {
              "use server";
              await updatePassword(null, fd);
            }}
            className="space-y-4"
          >
            <div>
              <Label htmlFor="password">{dict.auth.newPassword}</Label>
              <Input id="password" name="password" type="password" required minLength={10} />
            </div>
            <Button type="submit" className="w-full">
              {dict.auth.updatePassword}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
