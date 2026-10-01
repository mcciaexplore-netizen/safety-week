import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Branch sign-in" };

export default async function LoginPage(props: PageProps<"/login">) {
  const { branch } = await props.searchParams;
  const code = Array.isArray(branch) ? branch[0] : branch;
  return <LoginForm branchCode={code ?? ""} />;
}
