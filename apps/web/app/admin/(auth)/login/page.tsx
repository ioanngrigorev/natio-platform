import { LoginForm } from "@/components/auth-forms";

export const metadata = { title: "Sign in" };

export default function AdminLoginPage() {
  return <LoginForm kind="admin" />;
}
