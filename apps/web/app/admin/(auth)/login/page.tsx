import { LoginForm } from "@/components/auth-forms";

export const metadata = { title: "Admin sign in" };

export default function AdminLoginPage() {
  return <LoginForm kind="admin" />;
}
